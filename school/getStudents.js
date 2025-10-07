'use strict';

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const args = process.argv.slice(2);
function getArg(k, d=null){ const h=args.find(a=>a.startsWith(k+'=')); return h? h.split('=').slice(1).join('='): d; }
const table   = getArg('--table','fake-Students');
const region  = getArg('--region', process.env.AWS_REGION || 'us-west-2');
const endpoint = getArg('--endpoint', process.env.DDB_ENDPOINT || 'http://localhost:8000'); // 本機就給 http://localhost:8000
const limit   = parseInt(getArg('--limit','10'), 10);

(async () => {
  const cfg = { region, endpoint: endpoint || undefined,
    credentials: endpoint ? { accessKeyId:'fake', secretAccessKey:'fake' } : undefined };
  const ddb = new DynamoDBClient(cfg);
  const doc = DynamoDBDocumentClient.from(ddb);
  const data = await doc.send(new ScanCommand({ TableName: table, Limit: limit }));
  console.log(`Read ${data.Count} items from ${table} ${endpoint? '@ '+endpoint:''}`);
  console.log(JSON.stringify(data.Items, null, 2));
})();
