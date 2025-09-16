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

// ---- 工具函式 ----
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, ans => { rl.close(); res(ans); }));
}

function normalizeInitial(ch) {
  const s = (ch ?? "").toString().normalize("NFKC").trim();
  return s ? s[0].toUpperCase() : "";
}
function isValidInitial(ch) { return /^[A-Z]$/.test(ch); }

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

// ---- 主流程：永遠互動輸入 ----
(async () => {
  try {
    // 若不是互動終端，直接退出（避免 CI 等非互動環境卡住）
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      console.error("請在可輸入的 Terminal 執行。");
      process.exit(1);
    }

    // 忽略命令列參數，永遠互動詢問
    let initial = "";
    while (!isValidInitial(initial)) {
      await new Promise(r => setTimeout(r, 500)); // 晚 0.5 秒再問
      const raw = await ask("請輸入要篩選的字首(A-Z):");
      initial = normalizeInitial(raw);
      if (!isValidInitial(initial)) console.log("請輸入 A-Z 的單一字母，重新再試。");
    }

    // 讀取 → 篩選 → 輸出
    const all = await scanAll();
    const filtered = all.filter(u =>
      (u.name || "").normalize("NFKC").toUpperCase().startsWith(initial)
      //(u.name || "")：如果 u.name 為 null/undefined，用空字串避免報錯。
      //normalize("NFKC")：把全形字轉成半形、合併等價字元（例如 Ａ → A）。
      //toUpperCase()：統一轉成大寫（忽略大小寫差異）。
    );

    const outputFile = `initial_${initial}_name.json`;
    const payload = {
      //輸出格式
      table: tableName,
      endpoint: clientCfg.endpoint,
      exportedAt: new Date().toISOString(),
      initial,
      count: filtered.length,
      items: filtered,
    };

    await fs.writeFile(outputFile, JSON.stringify(payload, null, 2), "utf8");
    console.log(`已輸出 ${outputFile}（共 ${filtered.length} 筆，name 以 ${initial} 開頭）`);
  } catch (e) {
    console.error("匯出失敗：", e);
    process.exit(1);
  }
})();
