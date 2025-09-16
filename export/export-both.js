// export-both.js
const fs = require("fs/promises");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

// === 你原本有的設定 ===
const tableName = "FakeUser";
const clientCfg = {
  region: "us-west-2",
  endpoint: "http://localhost:8000",
  credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
};
const ddb = new DynamoDBClient(clientCfg);
const doc = DynamoDBDocumentClient.from(ddb);

// 參數：輸出檔名基底（可選），預設 db_fakeuser
const base = process.argv[2] || "db_fakeuser";
const flatFile = `${base}_flat.json`;
const nestedFile = `${base}_nested.json`;
const diffFile = `${base}_diff.txt`;

// 掃描所有頁次，保留每一頁（給 nested 用）
async function scanAllPages() {
  const pages = [];        
  let ExclusiveStartKey;
  do {
    const resp = await doc.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey }));
    const arr = resp.Items ?? [];
    if (arr.length) pages.push(arr);   // 不展開，整頁包存
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return pages;
}

(async () => {
  try {
    const pages = await scanAllPages();

    // 版本1：展開（flat）
    const flat = [];
    for (const page of pages) flat.push(...page);

    // 版本2：巢狀（nested）
    const nested = pages; // 直接使用 pages（每頁一包）

    const exportedAt = new Date().toISOString();

    // 寫出 flat 版本
    const flatPayload = {
      table: tableName,
      endpoint: clientCfg.endpoint,
      exportedAt,
      count: flat.length,
      items: flat, // 一維陣列
    };
    await fs.writeFile(flatFile, JSON.stringify(flatPayload, null, 2), "utf8");

    // 寫出 nested 版本
    const nestedPayload = {
      table: tableName,
      endpoint: clientCfg.endpoint,
      exportedAt,
      pages: nested.length,        // 頁數
      countsPerPage: nested.map(p => p.length),
      items: nested,               // 二維陣列：Array<Array<Item>>
    };
    await fs.writeFile(nestedFile, JSON.stringify(nestedPayload, null, 2), "utf8");

    // 產出一個簡短「差異說明」文字檔（可有可無，但很好用）
    const diffText = [
      `Table: ${tableName}`,
      `Endpoint: ${clientCfg.endpoint}`,
      `ExportedAt: ${exportedAt}`,
      ``,
      `== 檔案差異 ==`,
      `A) ${flatFile}：展開版（flat）`,
      `   - 結構：一維陣列`,
      `   - 總筆數：${flat.length}`,
      `   - 範例型別：typeof items[0] = ${flat.length ? typeof flat[0] : 'N/A'}`,
      ``,
      `B) ${nestedFile}：巢狀版（nested）`,
      `   - 結構：二維陣列（每頁一個子陣列）`,
      `   - 頁數：${nested.length}`,
      `   - 各頁筆數：${nested.map(p => p.length).join(', ') || 'N/A'}`,
      `   - 範例型別：Array.isArray(items[0]) = ${Array.isArray(nested[0])}`,
      nested.length ? `   - 第一頁第一筆是否等同 flat[0]：${flat.length ? JSON.stringify(nested[0][0]) === JSON.stringify(flat[0]) : 'N/A'}` : '',
      ``,
      `== 使用說明 ==`,
      `- flat 檔案（${flatFile}）適合直接走資料列處理（map/filter/reduce）。`,
      `- nested 檔案（${nestedFile}）保留分頁邏輯，適合想檢視每次 Scan 回傳批次的情境。`,
      ``,
    ].join('\n');

    await fs.writeFile(diffFile, diffText, "utf8");

    console.log(`✅ 已輸出：${flatFile}（展開版）`);
    console.log(`✅ 已輸出：${nestedFile}（巢狀版）`);
    console.log(`ℹ️ 差異說明：${diffFile}`);
  } catch (e) {
    console.error("❌ 匯出失敗：", e);
    process.exit(1);
  }
})();
