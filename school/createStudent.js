'use strict';
// File: createStudent.js

//假連線到AWS的DynamoDB
const {
  DynamoDBClient, CreateTableCommand, DescribeTableCommand
} = require("@aws-sdk/client-dynamodb");
const { waitUntilTableExists } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const fs = require('fs');
//為避免callback地獄 加入 "fs/promises" -> 可使用await + try/catch
const fsp = require('fs/promises');
const path = require('path');
//生成假資料的套件
const Chance = require('chance');

// DynamoDB 參數
let table = 'fake-Students';                   // 表格名
let region = process.env.AWS_REGION || 'us-west-2';
let endpoint = process.env.DDB_ENDPOINT || 'http://localhost:8000'; // 本機: http://localhost:8000 如果沒加 會跑到雲端
let noDb = false;

// --- CLI Args ---
// Usage examples:
//   node createStudent.js                 # 預設 50 筆
//   node createStudent.js 100             # 帶參數 100筆
//   node createStudent.js --count=200     # 帶參數 200筆
//   node createStudent.js --seed=42 --out=students.json    # 指定亂數種子--seed= , 輸出檔名 --out=students.json

const args = process.argv.slice(2);
let count = 200; //由這裡決定預設
let out = null;
let seed = null;

//定義指令後加入什麼參數會產生什麼
for (const a of args) {
  if (/^\d+$/.test(a)) {
    count = parseInt(a, 10);//  
  } else if (a.startsWith('--count=')) {
    //   node createStudent.js --count=200     # 帶參數 200筆
    count = parseInt(a.split('=')[1], 10);
  } else if (a.startsWith('--out=')) {
    //   node createStudent.js --out=students.json  輸出檔名 --out=students.json
    out = a.split('=')[1];
  } else if (a.startsWith('--seed=')) {
    //   node createStudent.js --seed=42  # 指定亂數種子 --seed= 
    seed = Number(a.split('=')[1]);
  }
  // --- DynamoDB 相關的 ---
  else if (a.startsWith('--table=')) {
    //   node createStudent.js --table=Students   #表格名
    table = a.split('=')[1];
  } else if (a.startsWith('--region=')) {
    //   node createStudent.js --region=us-west-2   #指定連網區域
    region = a.split('=')[1];
  } else if (a === '--no-db') {
    //   node createStudent.js --no-db   #
    noDb = true;
  }
}

const chance = Number.isFinite(seed) ? new Chance(seed) : new Chance();
// if (Number.isFinite(seed)) chance.seed(seed); 改為上面這個

function makeAddress() {
  const street = chance.address();
  const city = chance.city();
  const state = chance.state({ full: true });
  const zip = chance.zip();
  const country = 'USA';
  return `${street}, ${city}, ${state} ${zip}, ${country}`;
}

function createStudent() {
  return {
    name: chance.name(),
    grade: chance.integer({ min: 9, max: 12 }), //年級
    email: chance.email({ domain: 'example.edu' }),
    address: makeAddress(),
  };
}
// --- DynamoDB helpers（新增） ---
async function ensureTable(ddbClient, tableName, pkName) {
  try {
    await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`資料表已存在：${tableName}`);
    return false;
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
  }
  await ddbClient.send(new CreateTableCommand({
    TableName: tableName,
    AttributeDefinitions: [{ AttributeName: pkName, AttributeType: 'S' }],
    KeySchema: [{ AttributeName: pkName, KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await waitUntilTableExists({ client: ddbClient, maxWaitTime: 60 }, { TableName: tableName });
  console.log(`已建立資料表：${tableName}`);
  return true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function batchWriteAll(docClient, tableName, items) {
  let ok = 0;
  for (let i = 0; i < items.length; i += 25) {
    let slice = items.slice(i, i + 25).map(Item => ({ PutRequest: { Item } }));
    let request = { RequestItems: { [tableName]: slice } };

    for (let attempt = 0; attempt < 6; attempt++) {
      const resp = await docClient.send(new BatchWriteCommand(request));
      const unp = resp.UnprocessedItems?.[tableName] || [];
      ok += slice.length - unp.length;
      if (!unp.length) break;
      const backoff = Math.min(1000 * (2 ** attempt), 8000);
      await sleep(backoff);
      request = { RequestItems: { [tableName]: unp } }; // 重試未處理的
      slice = unp;
    }
  }
  return ok;
}

const students = Array.from({ length: count }, () => createStudent());

if (out) {
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, JSON.stringify(students, null, 2), 'utf8');
  console.log(`Wrote ${students.length} students to ${outPath}`);
} else {
  console.log(JSON.stringify(students, null, 2));
}
// --- 寫入 DynamoDB（新增；可用 --no-db 略過） ---
(async () => {
  try {
    if (noDb) {
      console.log('已略過 DynamoDB 寫入（--no-db）。');
      return;
    }

    // 這裡用 id 做主鍵：若你未來要用學號作 PK，再改表或新增 GSI
    // => 先幫每筆補一個 id（如果你想保持原樣，也可以在 createStudent 裡就加）
    const withIds = students.map(s => ({ id: chance.guid(), ...s }));

    const clientCfg = {
      region,
      endpoint: endpoint || undefined,
      credentials: endpoint ? { accessKeyId: 'fake', secretAccessKey: 'fake' } : undefined,
    };
    const ddb = new DynamoDBClient(clientCfg);
    const doc = DynamoDBDocumentClient.from(ddb, {
      marshallOptions: { removeUndefinedValues: true },
    });

    await ensureTable(ddb, table, 'id');
    const written = await batchWriteAll(doc, table, withIds);
    console.log(`DynamoDB 寫入完成：${written}/${withIds.length} 筆 → ${table} ${endpoint ? '@ ' + endpoint : ''}`);
  } catch (e) {
    console.error('DynamoDB 寫入失敗：', e);
    process.exitCode = 1;
  }
})();