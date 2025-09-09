// seed-local-fakeuser.js
const {
    DynamoDBClient, CreateTableCommand, DescribeTableCommand
  } = require("@aws-sdk/client-dynamodb");
  const { waitUntilTableExists } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");
  
  const tableName = "FakeUser";
  
  // 本機連線設定（重點：endpoint 指向 localhost、credentials 用假值即可）
  const clientCfg = {
    region: "us-west-2",
    endpoint: "http://localhost:8000",
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  };
  const ddb = new DynamoDBClient(clientCfg);
  const doc = DynamoDBDocumentClient.from(ddb);
  
  async function ensureTable() {
    try {
      await ddb.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`ℹ️ 資料表已存在：${tableName}`);
    } catch (e) {
      if (e.name !== "ResourceNotFoundException") throw e;
      console.log(`🆕 建立資料表：${tableName}`);
      await ddb.send(new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      }));
      await waitUntilTableExists({ client: ddb, maxWaitTime: 30 }, { TableName: tableName });
      console.log("✅ 資料表已就緒");
    }
  }
  
  function genUsers(n = 50) {
    const first = ["Alice","Bob","Carol","David","Emily","Frank","Grace","Hank","Ivy","Jack","Kim","Leo","Mia","Nina","Owen","Paul","Quinn","Ray","Sara","Tom"];
    const last  = ["Chen","Wang","Lin","Liu","Huang","Zhang","Wu","Tsai","Yang","Li","Chang","Hsu","Kuo","Chou","Hsieh"];
    const pad = (x) => String(x).padStart(3, "0");
    const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];
    return Array.from({ length: n }, (_, i) => {
      const id = `u${pad(i+1)}`;
      const fn = pick(first), ln = pick(last);
      return {
        id,
        name: `${fn} ${ln}`,
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}+${id}@example.com`,
        grade: 1 + (i % 12),
        createdAt: new Date().toISOString()
      };
    });
  }
  
  async function batchPut(items) {
    // BatchWrite 每次最多 25 筆 超過就要跑第二次
    let remaining = items.map(Item => ({ PutRequest: { Item } }));
    let written = 0;
  
    while (remaining.length) {
      const chunk = remaining.slice(0, 25);
      remaining = remaining.slice(25);
  
      const resp = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: chunk } }));
      const un = (resp.UnprocessedItems && resp.UnprocessedItems[tableName]) || [];
      written += (chunk.length - un.length);
  
      // 若有未處理項目，簡單重試
      let retry = un;
      let backoff = 100;
      while (retry.length) {
        await new Promise(r => setTimeout(r, backoff));
        const r2 = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: retry } }));
        const still = (r2.UnprocessedItems && r2.UnprocessedItems[tableName]) || [];
        written += (retry.length - still.length);
        retry = still;
        backoff = Math.min(backoff * 2, 2000);
      }
    }
    return written;
  }
  
  (async () => {
    const count = parseInt(process.argv[2] || "50", 10);
    console.log(`本機種資料：${tableName}（${count} 筆）`);
    await ensureTable();
    const items = genUsers(count);
    const ok = await batchPut(items);
    console.log(`完成，寫入 ${ok}/${count} 筆假資料`);
  })();
  