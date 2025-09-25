// File: createStudent.js
'use strict';

const fs = require('fs');
const path = require('path');
const Chance = require('chance');
const chance = new Chance();

// --- CLI Args ---
// Usage examples:
//   node createStudent.js                 # default 50
//   node createStudent.js 100             # count = 100
//   node createStudent.js --count=200
//   node createStudent.js --seed=42 --out=students.json
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

function createStudent() {
  return {
    name: chance.name(),
    grade: chance.integer({ min: 1, max: 12 }),
    email: chance.email({ domain: 'example.edu' }),
    address: makeAddress(),
  };
}

const students = Array.from({ length: count }, () => createStudent());

if (out) {
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, JSON.stringify(students, null, 2), 'utf8');
  console.log(`Wrote ${students.length} students to ${outPath}`);
} else {
  console.log(JSON.stringify(students, null, 2));
}
