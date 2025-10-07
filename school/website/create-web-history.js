// create-web-history.js
'use strict';


//連線到DynanoDb
const fs = require('fs/promises');
const crypto = require('crypto');
const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,

} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  paginateScan,
  BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');

// 
// 基本設定
// 
const Read_Table = "fake-Students";
const DEST_TABLE = "Student_Site_views";

const clientCfg = {
  region: "us-west-2",
  endpoint: "http://localhost:8000",
  Credentials: { accessKeyId: "fake", secretAccessKey: "fake" }
};

const ddb = new DynamoDBClient(clientCfg);
const doc = DynamoDBDocumentClient.from(ddb);

const SITES = [
  'youtube.com', 'spotify.com', 'twitch.tv', 'vimeo.com', 'music.apple.com',
  'facebook.com', 'instagram.com', 'x.com', 'reddit.com', 'tiktok.com',
  'roblox.com', 'minecraft.net', 'epicgames.com', 'leagueoflegends.com', 'store.steampowered.com',
  'ㄆhanacademy.org', 'coursera.org', 'edx.org', 'classroom.google.com', 'wikipedia.org'
];
// 參數：每位學生要產生幾筆 帶入則使用per ?
const perStudent = parseInt((process.argv[2] === 'per' && process.argv[3] || process.argv[2] || '5', 10)) || 5;
// 輸出檔名
const outFile = "student_site_views.json";

// 
//亂數工具
// 

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = Date.now();

//生產近14天的觀看時間 
function randomWatchedDate() {
  const randomTime = Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000);
  return new Date(now - randomTime).toISOString;
}

// 簡單唯一ID
function newViewId() {
  return crypto.randomUUID();
}

// 主要程式

// 確保目的表存在（Partition Key: studentEmail, Sort Key: viewId）
async function ensureDestTable() {
  try {
    await ddb.send(new DescribeTableCommand({ TableName: DEST_TABLE }));
    console.log(`資料表存在 => ${DEST_TABLE}`);
  } catch (e) {
    // 如果e=資源不存在 則不回傳錯誤
    if (e.name !== 'ResourceNotFoundException') throw e;
    console.log(`建立資料表：${DEST_TABLE}`);
    await ddb.send(new CreateTableCommand({
      TableName: DEST_TABLE,
      AttributeDefinitions: [
        { AttributeName: "studentEmail", AttributeType: "S" },
        { AttributeName: 'viewId', AttributeType: 'S' }
      ],
      KeySchema: [
        { AttributeName: 'studentEmail', KeyType: 'HASH' },
        { AttributeName: 'viewId', KeyType: 'RANGE' }
      ],
      BillingMode: 'PAY_PER_REQUEST'
    }))
    //稍等ddb回應 如用雲端則改使用 waiters
    // await waitUntilTableExists(
    // { client: ddb, maxWaitTime: 120, minDelay: 2, maxDelay: 5 }, // 秒
    // { TableName: "MyTable" }
    // );
    await new Promise(r => setTimeout(r, 1000));
    console.log("資料表已建立等候");
  }
}

// 掃描所有學生 （只抓需要的） 
async function scanStudents() {
  const students = [];
  const paginator = paginateScan(
    { client: doc },
    {
      TableName: Read_Table,
      ProjectionExpression: '#n, email',
      ExpressionAttributeNames: { '#n': 'name' },
    });
  //自動翻頁
  for await (const page of paginator) {
    for (const it of (page.Items ?? [])) {
      if (it?.email && it?.name) {
        students.push({ name: it.name, email: it.email });
      }
    }
  }
  return students;

  // let ExclusiveStartKey;
  // do {
  //   const resp = await doc.send(new ScanCommand({
  //     TableName: Read_Table,
  //     ProjectionExpression: '#n, email', // ProjectionExpression 用來抓取所需要的資料用
  //     ExpressionAttributeNames: { '#n': 'name' },
  //     ExclusiveStartKey
  //   }))
  //   for (const it of (resp.Items || [])) {
  //     if (it?.email && it?.name) {
  //       students.push({ name: it.name, email: it.email });
  //     }
  //   }
  //   // Scan 逐頁手動翻頁（用 LastEvaluatedKey 迴圈）
  //   ExclusiveStartKey = resp.LastEvaluatedKey;
  // } while (ExclusiveStartKey) {
  //   return students;
  // }
}

async function BatchWritetryPush(items, {
  tableName = DEST_TABLE,
  maxAttempts = 6,     // 對 UnprocessedItems 的最大重試次數
  baseDelayMs = 100,   // 起始退避
  maxDelayMs = 2000    // 每次重試延遲上限
} = {}) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let remaining = items.map(Item => ({ PutRequest: { Item } }));
  let written = 0;

  while (remaining.length) {
    const batch = remaining.slice(0, 25);
    remaining = remaining.slice(25);

    let resp;
    try {
      resp = await doc.send(new BatchWriteCommand({
        RequestItems: { [tableName]: batch }
      }));
    } catch (err) {
      console.warn('BatchWriteCommand 失敗，將對整批重試：', err?.message || err);
      resp = { UnprocessedItems: { [tableName]: batch } };
    }

    let un = (resp.UnprocessedItems && resp.UnprocessedItems[tableName]) || [];
    written += (batch.length - un.length);

    // 指數退避 + 抖動
    let attempt = 0;
    while (un.length && attempt < maxAttempts) {
      attempt++;
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + jitter, maxDelayMs);
      await new Promise(r => setTimeout(r, delay));

      try {
        const r2 = await doc.send(new BatchWriteCommand({
          RequestItems: { [tableName]: un }
        }));
        const still = (r2.UnprocessedItems && r2.UnprocessedItems[tableName]) || [];
        written += (un.length - still.length);
        un = still;
      } catch (err) {
        console.warn(`重試第 ${attempt} 次仍失敗：`, err?.message || err);
        // 保持 un，進入下一輪
      }
    }

    if (un.length) {
      console.warn(`仍有未處理項目（放棄）：${un.length} 筆`);
      // 需要時可把未寫入項目存檔：un.map(x => x.PutRequest.Item)
    }
  }

  return written;

  // while (remaining.length) {
  //   const chunk = remaining.slice(0, 25);
  //   remaining = remaining.slice(25);

  //   const resp = await doc.send(new BatchWriteCommand({
  //     RequestItems: { [DEST_TABLE]: chunk }
  //   }));
  //   const un = (resp.UnprocessedItems && resp.UnprocessedItems[DEST_TABLE]) || [];
  //   written += (chunk.length - un.length);

  //   let retry = un;
  //   let backoff = 100;
  //   while (retry.length) {
  //     await new Promise(r => setTimeout(r, backoff));
  //     const r2 = await doc.send(new BatchWriteCommand({
  //       RequestItems: { [DEST_TABLE]: retry }
  //     }));
  //     const still = (r2.UnprocessedItems && r2.UnprocessedItems[DEST_TABLE]) || [];
  //     written += (retry.length - still.length);
  //     retry = still;
  //     backoff = Math.min(backoff * 2, 2000);
  //   }
  // }
  // return written;
}

(async () => {
  try {
    console.log(`來源學生表：${Read_Table}；目的表：${DEST_TABLE}`);
    console.log(`來源學生表：${Read_Table}；目的表：${DEST_TABLE}`);
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
          watchedAt: randomWatchedDate(),
          studentName: s.name
        });
      }
    }

    // 寫入 DDB
    const ok = await BatchWritetryPush(views);
    console.log(`寫入 Student_Site_views：${ok}/${views.length} 筆`);

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