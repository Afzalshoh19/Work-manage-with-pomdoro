/**
 * Deploy uchun `dist/` papkasini yig'adi.
 *
 *   node build.mjs
 *
 * Loyihada qurish bosqichi (bundler, transpiler) yo'q — kod qanday bo'lsa
 * shundayligicha ishlaydi. Shuning uchun bu skript faqat serverda kerak
 * bo'ladigan fayllarni ajratib oladi va deploy uchun qo'shimchalarni yozadi.
 *
 * `data/` hech qachon ko'chirilmaydi: unda baza, parol xeshlari va
 * shifrlash kaliti bor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

/* Serverda kerak bo'ladigan narsalar */
const INCLUDE = ['server.js', 'package.json', 'README.md', 'DEPLOY.md', 'lib', 'routes', 'public'];

/* Hech qachon tushmaydigan fayllar */
const SKIP = new Set(['data', 'dist', 'node_modules', '.git', 'build.mjs', 'ishga-tushirish.bat']);
const SKIP_RE = /(^\.|\.log$|\.tmp$|\.secret$|^db\.json$)/;

let files = 0, bytes = 0;

function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (SKIP.has(name) || SKIP_RE.test(name)) continue;
      copy(path.join(src, name), path.join(dst, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  files++;
  bytes += st.size;
}

/* ── 1. Toza dist ── */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const name of INCLUDE) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    console.warn(`  ! ${name} topilmadi, o'tkazib yuborildi`);
    continue;
  }
  copy(src, path.join(DIST, name));
}

/* ── 2. package.json — deploy uchun moslash ── */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
pkg.scripts = { start: 'node server.js' };
delete pkg.devDependencies;
fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

/* ── 3. Muhit o'zgaruvchilari namunasi ── */
fs.writeFileSync(path.join(DIST, '.env.example'), `# Server qaysi portda tinglaydi
PORT=4123

# Konteynerda yoki serverda tashqaridan ulanish uchun 0.0.0.0 bo'lishi kerak.
# Faqat shu kompyuterdan kirilsa 127.0.0.1 qoldiring.
HOST=0.0.0.0

# Ma'lumotlar papkasi. Deploy qilinganda alohida diskda (volume) bo'lishi kerak,
# aks holda yangilanishda baza yo'qoladi.
DATA_DIR=/var/lib/pomodoro

# HTTPS orqali xizmat qilinsa 1 qiling - cookie'ga Secure bayrog'i qo'yiladi.
# NODE_ENV=production bo'lsa o'zi yoqiladi.
SECURE_COOKIES=1

NODE_ENV=production
`, 'utf8');

/* ── 4. Dockerfile ── */
fs.writeFileSync(path.join(DIST, 'Dockerfile'), `# Tashqi kutubxona yo'q - npm install kerak emas
FROM node:22-alpine

WORKDIR /app
COPY . .

# Baza konteyner ichida emas, alohida diskda saqlanadi
ENV NODE_ENV=production \\
    HOST=0.0.0.0 \\
    PORT=4123 \\
    DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 4123

# root emas, cheklangan foydalanuvchi ostida ishlaydi
RUN mkdir -p /data && chown -R node:node /data /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4123)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
`, 'utf8');

fs.writeFileSync(path.join(DIST, '.dockerignore'), `data
dist
node_modules
.git
*.log
.env
`, 'utf8');

/* ── 5. docker compose ── */
fs.writeFileSync(path.join(DIST, 'docker-compose.yml'), `services:
  pomodoro:
    build: .
    restart: unless-stopped
    ports:
      - "4123:4123"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: "4123"
      DATA_DIR: /data
      SECURE_COOKIES: "0"   # HTTPS orqali (reverse proxy) ishlatsangiz 1 qiling
    volumes:
      - pomodoro-data:/data

volumes:
  pomodoro-data:
`, 'utf8');

/* ── 6. systemd unit (Docker'siz oddiy server uchun) ── */
fs.writeFileSync(path.join(DIST, 'pomodoro.service'), `[Unit]
Description=Pomodoro - ish jarayonini boshqarish tizimi
After=network.target

[Service]
Type=simple
User=pomodoro
WorkingDirectory=/opt/pomodoro
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=4123
Environment=DATA_DIR=/var/lib/pomodoro
Restart=always
RestartSec=3

# Xavfsizlik cheklovlari
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pomodoro

[Install]
WantedBy=multi-user.target
`, 'utf8');

/* ── 7. Yig'ish ma'lumoti ── */
fs.writeFileSync(path.join(DIST, 'build-info.json'), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  builtAt: new Date().toISOString(),
  node: process.version,
  files
}, null, 2) + '\n', 'utf8');

console.log(`\n  dist/ tayyor`);
console.log(`  ${files} fayl · ${(bytes / 1024).toFixed(0)} KB`);
console.log(`  Ishga tushirish:  cd dist && node server.js\n`);
