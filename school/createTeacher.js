// File: createTeacher.js
'use strict'; //嚴格模式 

const {
  DynamoDBClient, CreateTableCommand, DescribeTableCommand
} = require("@aws-sdk/client-dynamodb");
const { waitUntilTableExists } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const fs = require('fs');
const path = require('path');
const Chance = require('chance');
const chance = new Chance();

// --- CLI Args ---
// Usage examples:
//   node createTeacher.js                 # default 50
//   node createTeacher.js 100             # count = 100
//   node createTeacher.js --count=200
//   node createTeacher.js --seed=42 --out=teachers.json
const args = process.argv.slice(2);
let count = 50;
let out = null;
let seed = null;

for (const a of args) {
  if (/^\d+$/.test(a)) {
    count = parseInt(a, 10);
  } else if (a.startsWith('--count=')) {
    count = parseInt(a.split('=')[1], 10);
  } else if (a.startsWith('--out=')) {
    out = a.split('=')[1];
  } else if (a.startsWith('--seed=')) {
    seed = Number(a.split('=')[1]);
  }
}

if (Number.isFinite(seed)) chance.seed(seed);

function makeAddress() {
  const street = chance.address();
  const city = chance.city();
  const state = chance.state({ full: true });
  const zip = chance.zip();
  const country = 'USA';
  return `${street}, ${city}, ${state} ${zip}, ${country}`;
}

const subjects = [
  'Chinese', 'English', 'Mathematics', 'Science', 'Social Studies',
  'History', 'Geography', 'Civics',
  'Physics', 'Chemistry', 'Biology', 'Music', 'Art',
  'Physical Education', 'Information Technology'
];


function createTeacher() {
  return {
    name: chance.name(),
    subject: chance.pickone(subjects),
    email: chance.email({ domain: 'example.edu' }),
    address: makeAddress(),
  };
}

const teachers = Array.from({ length: count }, () => createTeacher());

if (out) {
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, JSON.stringify(teachers, null, 2), 'utf8');
  console.log(`Wrote ${teachers.length} teachers to ${outPath}`);
} else {
  console.log(JSON.stringify(teachers, null, 2));
}
