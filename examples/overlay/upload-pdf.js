// Upload to gofile.io — free, no account needed, direct download link
const fs = require('fs');
const https = require('https');

const filePath = 'C:/Users/user/Desktop/JARVIS-Build-Plan.pdf';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

function upload(server, fileData, fileName) {
  return new Promise((resolve, reject) => {
    const boundary = '----Boundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fileName + '"\r\nContent-Type: application/pdf\r\n\r\n'),
      fileData,
      Buffer.from('\r\n--' + boundary + '--\r\n')
    ]);
    const opts = {
      hostname: server,
      path: '/uploadFile',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Getting upload server...');
  const serverInfo = await get('https://api.gofile.io/servers');
  const server = serverInfo.data.servers[0].name;
  console.log('Uploading to', server + '...');
  const fileData = fs.readFileSync(filePath);
  const result = await upload(server + '.gofile.io', fileData, 'JARVIS-Build-Plan.pdf');
  if (result.status === 'ok') {
    console.log('\n✅ SHAREABLE LINK:');
    console.log(result.data.downloadPage);
  } else {
    console.log('Failed:', JSON.stringify(result));
  }
}

main().catch(console.error);
