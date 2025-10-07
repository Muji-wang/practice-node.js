// create-web-history.js
'use strict';


//連線到DynanoDb
const fs = require('fs/promises');
const crypto = require('crypto');
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');

//
//  基本設定 
//
const SRC_TABLE = 'fake-Students';           // 來源學生表 名稱不同換這
const DEST_TABLE = 'StudentSiteViews';       // 產生的觀看紀錄表

const clientCfg = {
  region: 'us-west-2',
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
}; 
const ddb = new DynamoDBClient(clientCfg);
const doc = DynamoDBDocumentClient.from(ddb);

// 網站清單
const SITES = [
  'youtube.com', 'spotify.com', 'twitch.tv', 'vimeo.com', 'music.apple.com',
  'facebook.com', 'instagram.com', 'x.com', 'reddit.com', 'tiktok.com',
  'roblox.com', 'minecraft.net', 'epicgames.com', 'leagueoflegends.com', 'store.steampowered.com',
  'ㄆkhanacademy.org', 'coursera.org', 'edx.org', 'classroom.google.com', 'wikipedia.org'
];

// 參數：每位學生要產生幾筆
const perStudent = parseInt((process.argv[2] === '--per' && process.argv[3]) || process.argv[2] || '5', 10) || 5;
// 輸出檔名
const outFile = `student_site_views.json`;

//
//  工具 
//
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = Date.now();

function randomWatchedAtISO() {
  // 近 14 天內隨機時間
  const ms = Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000);
  return new Date(now - ms).toISOString();
}

function newViewId() {
  // 簡單唯一 ID（也可改用 ULID/Nanoid）
  return crypto.randomUUID();
}

//
//  動作 
//

// 確保目的表存在（Partition Key: studentEmail, Sort Key: viewId）
async function ensureDestTable() {
  try {
    await ddb.send(new DescribeTableCommand({ TableName: DEST_TABLE }));
    console.log(`資料表已存在：${DEST_TABLE}`);
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    console.log(`建立資料表：${DEST_TABLE}`);
    await ddb.send(new CreateTableCommand({
      TableName: DEST_TABLE,
      AttributeDefinitions: [
        { AttributeName: 'studentEmail', AttributeType: 'S' },
        { AttributeName: 'viewId',       AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'studentEmail', KeyType: 'HASH' },
        { AttributeName: 'viewId',       KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    // 簡單等一下（DDB Local 很快；雲端可改用 waiters）
    await new Promise(r => setTimeout(r, 1000));
    console.log("資料表已建立等候");
  }
}

// 掃描所有學生（僅取需要欄位）
async function scanStudents() {
  const students = [];
  let ExclusiveStartKey;
  do {
    const resp = await doc.send(new ScanCommand({
      TableName: SRC_TABLE,
      // ProjectionExpression 用來抓取所需要的欄位用
      ProjectionExpression: '#n, email',
      ExpressionAttributeNames: { '#n': 'name' },
      ExclusiveStartKey
    }));
    for (const it of (resp.Items || [])) {
      if (it?.email && it?.name) students.push({ name: it.name, email: it.email });
    }
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return students;
}

// 分次寫入（25 筆/次，尚未成功也會被計算）
async function batchPutAll(items) {
  let remaining = items.map(Item => ({ PutRequest: { Item } }));
  let written = 0;

  while (remaining.length) {
    const chunk = remaining.slice(0, 25);
    remaining = remaining.slice(25);

    const resp = await doc.send(new BatchWriteCommand({
      RequestItems: { [DEST_TABLE]: chunk }
    }));
    const un = (resp.UnprocessedItems && resp.UnprocessedItems[DEST_TABLE]) || [];
    written += (chunk.length - un.length);

    let retry = un;
    let backoff = 100;
    while (retry.length) {
      await new Promise(r => setTimeout(r, backoff));
      const r2 = await doc.send(new BatchWriteCommand({
        RequestItems: { [DEST_TABLE]: retry }
      }));
      const still = (r2.UnprocessedItems && r2.UnprocessedItems[DEST_TABLE]) || [];
      written += (retry.length - still.length);
      retry = still;
      backoff = Math.min(backoff * 2, 2000);
    }
  }
  return written;
}

(async () => {
  try {
    console.log(`來源學生表：${SRC_TABLE}；目的表：${DEST_TABLE}`);
    await ensureDestTable();

    const students = await scanStudents();
    if (!students.length) {
      console.warn('找不到任何學生');
      process.exit(0);
    }
    console.log(`學生數：${students.length}，每位產生：${perStudent} 筆`);

    // 產生觀看紀錄
    const views = [];
    for (const s of students) {
      for (let i = 0; i < perStudent; i++) {
        views.push({
          studentEmail: s.email,
          viewId: newViewId(),
          url: `https://${pick(SITES)}`,
          watchedAt: randomWatchedAtISO(),
          studentName: s.name
        });
      }
    }

    // 寫入 DDB
    const ok = await batchPutAll(views);
    console.log(`寫入 StudentSiteViews：${ok}/${views.length} 筆`);

    const payload = {
      table: DEST_TABLE,
      endpoint: clientCfg.endpoint,
      exportedAt: new Date().toISOString(),
      count: views.length,
      items: views
    };
    await fs.writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`輸出本機：${outFile}（共 ${views.length} 筆）`);

  } catch (err) {
    console.error('執行失敗：', err);
    process.exit(1);
  }
})();
