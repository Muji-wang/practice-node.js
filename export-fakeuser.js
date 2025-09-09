// export-local-fakeuser.js
const fs = require("fs/promises");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const tableName = "FakeUser";
const outFile = "db_fakeuser.json";

const clientCfg = {
  region: "us-west-2",
  endpoint: "http://localhost:8000",
  credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
};
const ddb = new DynamoDBClient(clientCfg);
const doc = DynamoDBDocumentClient.from(ddb);

async function scanAll() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const resp = await doc.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey }));
    if (resp.Items?.length) items.push(...resp.Items);
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

(async () => {
  try {
    const items = await scanAll();
    const output = {
      table: tableName,
      endpoint: "http://localhost:8000",
      exportedAt: new Date().toISOString(),
      count: items.length,
      items
    };
    await fs.writeFile(outFile, JSON.stringify(output, null, 2), "utf8");
    console.log(`輸出了 ${outFile}（總共有：${items.length}個假資料）`);
  } catch (e) {
    console.error("這次匯出失敗：", e);
    process.exit(1);
  }
})();