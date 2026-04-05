const { spawn } = require('child_process');

const scenario = process.argv[2];
const proxyBaseUrl = process.env.PROXYARMOR_BASE_URL || 'http://localhost:9090';

const scenarios = {
  'login-bruteforce': [
    'autocannon',
    '-m',
    'POST',
    '-c',
    '20',
    '-d',
    '5',
    '-H',
    'content-type=application/json',
    '-b',
    JSON.stringify({
      username: 'judge-demo',
      password: 'wrong-password'
    }),
    `${proxyBaseUrl}/login`
  ],
  'users-load': [
    'autocannon',
    '-c',
    '100',
    '-d',
    '10',
    `${proxyBaseUrl}/users`
  ],
  'users-5000': [
    'autocannon',
    '-a',
    '5000',
    '-c',
    '100',
    `${proxyBaseUrl}/users`
  ]
};

if (!scenario || !scenarios[scenario]) {
  console.error('Usage: node scripts/runAutocannon.js <login-bruteforce|users-load|users-5000>');
  process.exit(1);
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const commandArgs = ['--yes', ...scenarios[scenario]];
const spawnOptions = {
  stdio: 'inherit',
  shell: process.platform === 'win32'
};

console.log(`Running: ${command} ${commandArgs.join(' ')}`);

const child = spawn(command, commandArgs, spawnOptions);

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (error) => {
  console.error(`Failed to start autocannon: ${error.message}`);
  process.exit(1);
});
