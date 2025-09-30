'use strict';

const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const Chance = require('chance');

// ---- CLI ----
const args = process.argv.slice(2);
const getArg = (k, d=null)=>{const h=args.find(a=>a.startsWith(k+'='));return h?h.split('=').slice(1).join('='):d}
const has = f=>args.includes(f);

const studentsTable = getArg('--students','fake-Students');
const classesTable  = getArg('--classes','fake-Classes');
const studentClassesTable = getArg('--studentClasses','fake-StudentClasses');

const endpoint = getArg('--endpoint', process.env.DDB_ENDPOINT || 'http://localhost:8000');
const region   = getArg('--region', process.env.AWS_REGION || 'us-west-2');
const seed     = Number(getArg('--seed','')) || null;
const classSize = parseInt(getArg('--class-size','25'),10);//一班最多為25人
const dryRun   = has('--dry-run');//測試用指令 不會建立資料庫

const chance = seed!==null ? new Chance(seed) : new Chance();

// ---- utils ----
const nowIso = () => new Date().toISOString();
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function scanAll(doc, table){
  const out=[]; let start;
  do{
    const resp = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey:start }));
    if (resp.Items) out.push(...resp.Items);
    start = resp.LastEvaluatedKey;
  }while(start);
  return out;
}
async function ensureClasses(ddb, table){
  try{ await ddb.send(new DescribeTableCommand({ TableName: table })); console.log(`資料表已存在：${table}`); return;
  }catch(e){ if (e.name!=='ResourceNotFoundException') throw e; }
  await ddb.send(new CreateTableCommand({
    TableName: table,
    AttributeDefinitions:[{ AttributeName:'id', AttributeType:'S' }],
    KeySchema:[{ AttributeName:'id', KeyType:'HASH' }],
    BillingMode:'PAY_PER_REQUEST',
  }));
  await waitUntilTableExists({ client: ddb, maxWaitTime:60 }, { TableName: table });
  console.log(`已建立資料表：${table}`);
}
async function ensureStudentClasses(ddb, table){
  try{ await ddb.send(new DescribeTableCommand({ TableName: table })); console.log(`資料表已存在：${table}`); return;
  }catch(e){ if (e.name!=='ResourceNotFoundException') throw e; }
  await ddb.send(new CreateTableCommand({
    TableName: table,
    AttributeDefinitions:[
      { AttributeName:'studentId', AttributeType:'S' },
      { AttributeName:'classId',   AttributeType:'S' },
    ],
    KeySchema:[{ AttributeName:'studentId', KeyType:'HASH' }],
    BillingMode:'PAY_PER_REQUEST',
    GlobalSecondaryIndexes:[{
      IndexName:'byClass',
      KeySchema:[{ AttributeName:'classId', KeyType:'HASH' }],
      Projection:{ ProjectionType:'ALL' }
    }]
  }));
  await waitUntilTableExists({ client: ddb, maxWaitTime:60 }, { TableName: table });
  console.log(`已建立資料表（含 GSI byClass):${table}`);
}
async function batchWriteAll(doc, table, items){
  let ok=0;
  for (let i=0;i<items.length;i+=25){
    let slice = items.slice(i,i+25).map(Item=>({PutRequest:{Item}}));
    let req = { RequestItems: { [table]: slice } };
    for (let a=0;a<6;a++){
      const resp = await doc.send(new BatchWriteCommand(req));
      const unp = resp.UnprocessedItems?.[table] || [];
      ok += slice.length - unp.length;
      if (!unp.length) break;
      await sleep(Math.min(1000*(2**a),8000));
      req = { RequestItems: { [table]: unp } };
      slice = unp;
    }
  }
  return ok;
}

// ---- main ----
(async()=>{
  const cfg = { region, endpoint: endpoint||undefined, credentials: endpoint?{accessKeyId:'fake',secretAccessKey:'fake'}:undefined };
  //region：雲端時要用；本機其實無所謂，但 SDK 需要一個值(AWS SDK for JavaScript (v3))。
  //endpoint:有值（例如 http://localhost:8000）→ 連 dynamodb-local。 沒值（undefined）→ 連 雲端 AWS DynamoDB。
  //credentials: 若是本機（有 endpoint）→ 給「假憑證」fake/fake 即可（dynamodb-local 不驗證）。若是雲端（endpoint 為 undefined）→ 交給預設儲存在本機的（環境變數、~/.aws/credentials、SSO 等）。
  console.log(endpoint ? `DDB Mode: LOCAL @ ${endpoint}` : `DDB Mode: CLOUD (region=${region})`);
  const ddb = new DynamoDBClient(cfg);
  const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions:{ removeUndefinedValues:true } });

  // 讀學生（假設已只有 9–12 年級）
  const students = await scanAll(doc, studentsTable);
  console.log(`學生數：${students.length}（每班上限 ${classSize}）`);

  // 依年級分群 → 每群均分班
  const byGrade = new Map();
  for (const s of students){
    const g = Number(s.grade) || 9;             // 已保證 9–12
    if (!byGrade.has(g)) byGrade.set(g, []);
    byGrade.get(g).push(s);
  }

  const classes = [];
  const studentClasses = [];
  for (const [grade, list] of byGrade.entries()){
    const shuffled = chance.shuffle(list.slice());
    const n = Math.max(1, Math.ceil(shuffled.length/classSize));
    for (let i=0;i<n;i++){
      const clsStudents = shuffled.slice(i*classSize,(i+1)*classSize);
      if (!clsStudents.length) continue;
      const id = chance.guid();
      const name = `G${grade}-C${i+1}`;
      classes.push({ id, name, grade, createdAt: nowIso() });
      for (const s of clsStudents){
        studentClasses.push({ studentId: s.id, classId: id, createdAt: nowIso() });
      }
    }
  }

  console.log(`將建立班級 ${classes.length} 個、學生→班級 ${studentClasses.length} 筆。`);

  if (dryRun){
    console.log('（預跑）示例：', { classes: classes.slice(0,2), studentClasses: studentClasses.slice(0,5) });
    console.log('模擬完成，未寫入資料庫。');
    return;
  }

  await ensureClasses(ddb, classesTable);
  await ensureStudentClasses(ddb, studentClassesTable);

  const w1 = await batchWriteAll(doc, classesTable, classes);
  const w2 = await batchWriteAll(doc, studentClassesTable, studentClasses);

  console.log(`DynamoDB 寫入完成：`);
  console.log(`  ${classesTable}        : ${w1}/${classes.length}`);
  console.log(`  ${studentClassesTable} : ${w2}/${studentClasses.length}`);
  console.log(`全部完成！`);
})();
