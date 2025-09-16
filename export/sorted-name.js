// export-sorted-by-name.js
const fs = require("fs/promises");
const readline = require("readline");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const tableName = "FakeUser";
const clientCfg = {
  region: "us-west-2",
  endpoint: "http://localhost:8000",
  credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
};
const ddb = new DynamoDBClient(clientCfg);
const doc = DynamoDBDocumentClient.from(ddb);

// -- 工具:讀表(分頁掃描)
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

// -- 工具:互動選單(排序方式)
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}
async function askOrder() {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error("請在可輸入的 Terminal 執行。");
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 500)); // 晚 0.5 秒再顯示
  console.log("請選擇排序方式:");
  console.log("  [1] 升冪(A → Z)");
  console.log("  [2] 降冪(Z → A)");
  let ans = (await ask("輸入 1 或 2:")).trim();
  while (!["1","2"].includes(ans)) {
    ans = (await ask("請輸入有效選項(1 或 2):")).trim();
  }
  return ans === "2" ? "desc" : "asc";
}

// -- 排序設定
const norm = (s) => (s ?? "").toString().normalize("NFKC").trim();
const collator = new Intl.Collator("und", { sensitivity: "base", numeric: true, ignorePunctuation: true });
function sortByName(users, order = "asc") {
  const dir = order === "desc" ? -1 : 1;
  return users.sort((a, b) => {
    const an = norm(a.name), bn = norm(b.name);
    if (!an && !bn) return 0;
    if (!an) return 1;
    if (!bn) return -1;
    const primary = collator.compare(an, bn);
    if (primary !== 0) return primary * dir;
    return collator.compare(String(a.id ?? ""), String(b.id ?? "")) * dir;
  });
}

// -- 主流程
(async () => {
  try {
    const order = await askOrder(); // 在 terminal 選擇
    const items = await scanAll();
    const sorted = sortByName(items, order);

    const outFile = `sorted_name_${order}.json`;
    const payload = {
      table: tableName,
      endpoint: clientCfg.endpoint,
      exportedAt: new Date().toISOString(),
      order,
      count: sorted.length,
      items: sorted,
    };

    await fs.writeFile(outFile, JSON.stringify(payload, null, 2), "utf8");
    console.log(`完成:${outFile}(按 name ${order} 排序，${sorted.length} 筆)`);
  } catch (e) {
    console.error("匯出/排序失敗:", e);
    process.exit(1);
  }
})();
