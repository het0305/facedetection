// Create or reset an administrator account.
//   npm run create-admin -- <username>              (prompts for the password)
//   echo "<password>" | npm run create-admin -- <username> --password-stdin
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const Admin = require('../src/models/Admin');
const { passwordSchema } = require('../src/routes/auth');

function readHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) rl.output.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.replace(/\r?\n$/, '');
}

(async () => {
  const args = process.argv.slice(2);
  const username = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Usage: npm run create-admin -- <username>   (3-50 chars: a-z 0-9 . _ -)');
  }
  let password;
  if (args.includes('--password-stdin')) {
    password = await readStdin();
  } else {
    password = await readHidden('Password: ');
    if ((await readHidden('Repeat password: ')) !== password) throw new Error('Passwords do not match.');
  }
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(`Password ${check.error.issues[0].message}.`);

  await db.connect();
  await Admin.createIndexes();
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await Admin.findOne({ username }).select('+tokenVersion');
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.active = true;
    existing.failedLogins = 0;
    existing.lockUntil = undefined;
    existing.tokenVersion += 1;
    await existing.save();
    console.log(`Password reset for admin "${username}". Existing sessions were signed out.`);
  } else {
    await Admin.create({ username, passwordHash });
    console.log(`Admin "${username}" created.`);
  }
  await db.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await db.disconnect().catch(() => {});
  process.exit(1);
});
