'use strict';

const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const {
  DynamoDBClient, CreateTableCommand, DescribeTableCommand
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');

// =參數 
const argv = require('minimist')(process.argv.slice(2));
const baselinePath = argv.baseline || './category_baseline.json';
const viewsPath    = argv.views    || './student_site_views.json';
const dryRun       = !!argv.dryRun;

const TABLE = 'StudentCategorizedViews';

// 連線設定
const clientCfg = {
  region: process.env.AWS_REGION || 'us-west-2',
  endpoint: process.env.DDB_ENDPOINT || 'http://localhost:8000',
  credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
};
const ddb = new DynamoDBClient(clientCfg);
const doc = DynamoDBDocumentClient.from(ddb);

// === 工具 ===
function toDomain(u) {
  try {
    const h = new URL(u).hostname || '';
    return h.replace(/^www\./i, '');
  } catch {
    // 也許原始資料只有 domain；退而求其次
    return (u || '').replace(/^https?:\/\//, '').replace(/^www\./i, '').split('/')[0];
  }
}

function buildDomain2Category(baselineJson) {
  // 支援兩種格式：
  // 1) { "Video": ["youtube.com","vimeo.com"], "Music": ["spotify.com"] }
  // 2) [ { "domain": "youtube.com", "category": "Video" }, ...]
  const map = new Map();

  if (Array.isArray(baselineJson)) {
    for (const it of baselineJson) {
      if (it && it.domain && it.category) map.set(String(it.domain).toLowerCase(), String(it.category));
    }
  } else if (baselineJson && typeof baselineJson === 'object') {
    for (const [cat, domains] of Object.entries(baselineJson)) {
      if (Array.isArray(domains)) {
        for (const d of domains) map.set(String(d).toLowerCase(), String(cat));
      }
    }
  }
  return (domain) => map.get(String(domain || '').toLowerCase()) || 'Uncategorized';
}

async function ensureTable() {
  try {
    await ddb.send(new DescribeTableCommand({ TableName: TABLE }));
    return console.log(`資料表已存在：${TABLE}`);
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
  }

  console.log(`建立資料表（含 GSI）：${TABLE}`);
  await ddb.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'studentEmail', AttributeType: 'S' },
      { AttributeName: 'watchedAt',    AttributeType: 'S' },
      { AttributeName: 'category',     AttributeType: 'S' },
      { AttributeName: 'domain',       AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'studentEmail', KeyType: 'HASH' },
      { AttributeName: 'watchedAt',    KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'byCategoryTime',
        KeySchema: [
          { AttributeName: 'category',  KeyType: 'HASH' },
          { AttributeName: 'watchedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'byDomainTime',
        KeySchema: [
          { AttributeName: 'domain',    KeyType: 'HASH' },
          { AttributeName: 'watchedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'byStudentCategory',
        KeySchema: [
          { AttributeName: 'studentEmail', KeyType: 'HASH' },
          { AttributeName: 'category',     KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  }));
  // 簡單等待；雲端可改用 waiter
  await new Promise(r => setTimeout(r, 1200));
  console.log('資料表已就緒');
}

async function batchPutAll(table, items) {
  let remaining = items.map(Item => ({ PutRequest: { Item } }));
  let written = 0;

  while (remaining.length) {
    const chunk = remaining.slice(0, 25);
    remaining = remaining.slice(25);

    const resp = await doc.send(new BatchWriteCommand({
      RequestItems: { [table]: chunk }
    }));

    const un = resp.UnprocessedItems?.[table] || [];
    written += (chunk.length - un.length);

    // 重試未處理成功的資料
    let retry = un;
    let backoff = 100;
    while (retry.length) {
      await new Promise(r => setTimeout(r, backoff));
      const r2 = await doc.send(new BatchWriteCommand({
        RequestItems: { [table]: retry }
      }));
      const still = r2.UnprocessedItems?.[table] || [];
      written += (retry.length - still.length);
      retry = still;
      backoff = Math.min(backoff * 2, 2000);
    }
  }
  return written;
}

(async () => {
  try {
    console.log(`讀取分類基準：${baselinePath}`);
    const baselineRaw = await fs.readFile(path.resolve(baselinePath), 'utf8');
    const baselineJson = JSON.parse(baselineRaw);
    const toCategory = buildDomain2Category(baselineJson);

    console.log(`讀取觀看紀錄：${viewsPath}`);
    const viewsRaw = await fs.readFile(path.resolve(viewsPath), 'utf8');
    // 允許整包格式：{ items: [...] } 或直接是陣列 [...]
    const parsed = JSON.parse(viewsRaw);
    const items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.Items || []);
    if (!Array.isArray(items) || !items.length) {
      console.warn('⚠️ 讀不到任何觀看紀錄。請確認 student_site_views.json 格式。');
      return;
    }
    console.log(`來源紀錄筆數：${items.length}`);

    // 轉換 → 帶入 category/domain，並改用 watchedAt 當 SK
    const enriched = [];
    for (const v of items) {
      const domain = toDomain(v.url || v.domain || '');
      const category = toCategory(domain);
      // 缺 watchedAt 的話就跳過（本表 SK 需要）
      if (!v.watchedAt) continue;

      enriched.push({
        studentEmail: v.studentEmail,
        watchedAt: v.watchedAt,         // 作為 sort key（時間）
        // 原有欄位保留
        viewId: v.viewId,
        url: v.url,
        durationSec: v.durationSec,
        studentName: v.studentName,
        // 新增欄位
        domain,
        category
      });
    }

    console.log(`可寫入筆數：${enriched.length}`);

    if (dryRun) {
      console.log('（dryRun）示例 3 筆：');
      console.log(enriched.slice(0, 3));
      return;
    }

    await ensureTable();
    const ok = await batchPutAll(TABLE, enriched);
    console.log(`完成：寫入 ${ok}/${enriched.length} 筆到 ${TABLE}`);

  } catch (err) {
    console.error('執行失敗：', err);
    process.exit(1);
  }
})();
