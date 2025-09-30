// File: createTeacher.js

//假連線到AWS的DynamoDB
const {
  DynamoDBClient, CreateTableCommand, DescribeTableCommand
} = require("@aws-sdk/client-dynamodb");
const { waitUntilTableExists } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const fs = require('fs');
const path = require('path');
const Chance = require('chance');
const { finished } = require("stream");

// DynamoDB 參數（新增）
let table = 'fake-Teachers';                         // 表名（預設：fake-Teachers）
let region = process.env.AWS_REGION || 'us-west-2';  // 區域（對本機其實無所謂，但保留）
let endpoint = process.env.DDB_ENDPOINT || 'http://localhost:8000'; // 本機 dynamodb-local
let noDb = false;

// --- CLI Args ---
// Usage examples:
//   node createTeacher.js                 # 預設 50 筆
//   node createTeacher.js 100             # 帶參數 100筆
//   node createTeacher.js --count=200     # 帶參數 200筆
//   node createTeacher.js --seed=42 --out=teachers.json    # 指定亂數種子 --seed= , 輸出檔名 --out=teachers.json

const args = process.argv.slice(2);
let count = 50;
let out = null;
let seed = null;

for (const a of args) {
  if (/^\d+$/.test(a)) {
    count = parseInt(a, 10);
  } else if (a.startsWith('--count=')) {
    count = parseInt(a.split('=')[1], 10);
  } else if (a.startsWith('--out=')) {
    out = a.split('=')[1];
  } else if (a.startsWith('--seed=')) {
    seed = Number(a.split('=')[1]);
  }// --- DynamoDB 相關旗標（新增） ---
  else if (a.startsWith('--table=')) {
    table = a.split('=')[1];
  } else if (a.startsWith('--region=')) {
    region = a.split('=')[1];
  } else if (a === '--no-db') {
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

const subjects = [
  'Chinese', 'English', 'Mathematics', 'Science', 'Social Studies',
  'History', 'Geography', 'Civics',
  'Physics', 'Chemistry', 'Biology', 'Music', 'Art',
  'Physical Education', 'Information Technology'
];


function createTeacher() {
  return {
    id: chance.guid(), // DynamoDB PK，同時出現在 JSON
    name: chance.name(),
    subject: chance.pickone(subjects),
    email: chance.email({ domain: 'example.edu' }),
    address: makeAddress(),
  };
}// --- DynamoDB helpers（新增） ---
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

const teachers = Array.from({ length: count }, () => createTeacher());

if (out) {
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, JSON.stringify(teachers, null, 2), 'utf8');
  console.log(`Wrote ${teachers.length} teachers to ${outPath}`);
} else {
  console.log(JSON.stringify(teachers, null, 2));
}
// --- 寫入 DynamoDB（--no-db 可略過） ---
(async () => {
  try {
    if (noDb) {
      console.log('已略過 DynamoDB 寫入（--no-db）。');
      console.log(`🎉 全部完成：共 ${teachers.length} 位老師；已略過 DB 寫入。`);
      return;
    }

    // （此處維持你原本的 withIds/ensureTable/batchWriteAll）
    // 例：只在寫入前臨時補 id（跟學生一致）
    const withIds = teachers.map(t => ({ id: chance.guid(), ...t }));

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
    console.log(`全部完成：共 ${teachers.length} 位老師,DB:${table} ${endpoint ? '@ ' + endpoint : ''}`);
  } catch (e) {
    console.error('DynamoDB 寫入失敗：', e);
    process.exitCode = 1;
  }
})();
