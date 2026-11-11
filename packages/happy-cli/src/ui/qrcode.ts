import qrcode from 'qrcode-terminal';

/**
 * Display a QR code in the terminal for the given URL
 */
export function displayQRCode(url: string): void {
  console.log('='.repeat(80));
  console.log('用手机连接这台电脑');
  console.log('使用手机相机或浏览器扫码，在打开的页面中确认连接。');
  console.log('='.repeat(80));
  qrcode.generate(url, { small: true }, (qr) => {
    for (let l of qr.split('\n')) {
      console.log(' '.repeat(10) + l);
    }
  });
  console.log('='.repeat(80));
} 