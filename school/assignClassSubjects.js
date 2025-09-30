    const strictSubject = args.includes('--strict-subject');    
const {
    DynamoDBClient, CreateTableCommand, DescribeTableCommand, UpdateTableCommand
  } = require('@aws-sdk/client-dynamodb');
  const { waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
  const Chance = require('chance');
  
  // ---- CLI ----
  const args = process.argv.slice(2);
  const getArg = (k, d=null)=>{const h=args.find(a=>a.startsWith(k+'='));return h?h.split('=').slice(1).join('='):d}
  const has = f=>args.includes(f);
  
  const classesTable       = getArg('--classes','fake-Classes');
  const teachersTable      = getArg('--teachers','fake-Teachers');
  const classSubjectsTable = getArg('--classSubjects','fake-ClassSubjects');
  
  const endpoint = getArg('--endpoint', process.env.DDB_ENDPOINT || 'http://localhost:8000');
  const region   = getArg('--region',   process.env.AWS_REGION || 'us-west-2');
  const seed     = Number(getArg('--seed','')) || null;
  const dryRun   = has('--dry-run');
  
  const chance = seed!==null ? new Chance(seed) : new Chance();
  const SUBJECTS = [
    'Chinese','English','Mathematics','Science','Social Studies',
    'History','Geography','Civics','Physics','Chemistry','Biology',
    'Music','Art','Physical Education','Information Technology'
  ];
  
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
  async function ensureClassSubjects(ddb, table){
    try{
      const resp = await ddb.send(new DescribeTableCommand({ TableName: table }));
      const idxs = resp.Table.GlobalSecondaryIndexes||[];
      const hasByTeacher = idxs.some(g=>g.IndexName==='byTeacher');
      if (!hasByTeacher){
        await ddb.send(new UpdateTableCommand({
          TableName: table,
          AttributeDefinitions:[
            { AttributeName:'teacherId', AttributeType:'S' },
            { AttributeName:'subject',   AttributeType:'S' },
          ],
          GlobalSecondaryIndexUpdates:[{
            Create:{
              IndexName:'byTeacher',
              KeySchema:[
                { AttributeName:'teacherId', KeyType:'HASH' },
                { AttributeName:'subject',   KeyType:'RANGE' }
              ],
              Projection:{ ProjectionType:'ALL' },
              ProvisionedThroughput:{ ReadCapacityUnits:5, WriteCapacityUnits:5 }
            }
          }]
        }));
        console.log(`已為 ${table} 新增 GSI: byTeacher`);
      } else {
        console.log(`資料表已存在且含 GSI：${table}`);
      }
      return;
    }catch(e){ if (e.name!=='ResourceNotFoundException') throw e; }
  
    await ddb.send(new CreateTableCommand({
      TableName: table,
      AttributeDefinitions:[
        { AttributeName:'classId',   AttributeType:'S' },
        { AttributeName:'subject',   AttributeType:'S' },
        { AttributeName:'teacherId', AttributeType:'S' },
      ],
      KeySchema:[
        { AttributeName:'classId', KeyType:'HASH' },
        { AttributeName:'subject', KeyType:'RANGE' },
      ],
      BillingMode:'PAY_PER_REQUEST',
      GlobalSecondaryIndexes:[{
        IndexName:'byTeacher',
        KeySchema:[
          { AttributeName:'teacherId', KeyType:'HASH' },
          { AttributeName:'subject',   KeyType:'RANGE' }
        ],
        Projection:{ ProjectionType:'ALL' }
      }]
    }));
    await waitUntilTableExists({ client: ddb, maxWaitTime:60 }, { TableName: table });
    console.log(`已建立資料表（含 GSI byTeacher）：${table}`);
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
    console.log(endpoint ? `DDB Mode: LOCAL @ ${endpoint}` : `DDB Mode: CLOUD (region=${region})`);
    const ddb = new DynamoDBClient(cfg);
    const doc = DynamoDBDocumentClient.from(ddb, { marshallOptions:{ removeUndefinedValues:true } });
  
    // 讀班級與老師
    const classes  = await scanAll(doc, classesTable);
    const teachers = await scanAll(doc, teachersTable);
    console.log(`班級：${classes.length}；老師：${teachers.length}`);
    if (!classes.length || !teachers.length){ console.log('⚠️ 班級或老師為空，結束。'); return; }
  
    // 依科目歸類老師（優先用專長）
    const teacherBySubject = new Map();
    for (const sub of SUBJECTS){
      teacherBySubject.set(
        sub,
        teachers.filter(t => (t.subject||'').toLowerCase() === sub.toLowerCase())
      );
    }
  
    // 每班每科挑任課老師
    let skipped = 0;
    const classSubjects = [];
    for (const cls of classes) {
        const homeroom = teacherById.get(cls.homeroomTeacherId);
        const hrSub = (homeroom?.subject || '').toLowerCase();
        for (const sub of SUBJECTS) {
            // 班導的本職科 → 指派班導
            if (homeroom && sub.toLowerCase() === hrSub) {
            classSubjects.push({
                classId: cls.id,
                subject: sub,
                teacherId: homeroom.id,
                createdAt: nowIso(),
            });
            continue;
            }

            // 只從該科老師池挑；沒有就從缺
            const pool = teacherBySubject.get(sub) || [];
            if (pool.length > 0) {
            const t = chance.pickone(pool);
            classSubjects.push({
                classId: cls.id,
                subject: sub,
                teacherId: t.id,
                createdAt: nowIso(),
            });
            } else {
            skipped++;
            console.warn(`[SKIP] class=${cls.id} subject=${sub}: no matching teacher`);
            // 不 push，代表此科目前未指派
            }
        }
    }

    console.log(`指派完成：寫入 ${classSubjects.length} 筆；從缺 ${skipped} 科目。`);
    if (dryRun){
      console.log('（乾跑）示例：', classSubjects.slice(0,5));
      console.log('模擬完成，未寫入資料庫。');
      return;
    }
  
    await ensureClassSubjects(ddb, classSubjectsTable);
    const w = await batchWriteAll(doc, classSubjectsTable, classSubjects);
    console.log(`DynamoDB 寫入完成：${classSubjectsTable} ${w}/${classSubjects.length} 筆`);
    console.log('全部完成！可用 GSI byTeacher 查詢。');
  })();