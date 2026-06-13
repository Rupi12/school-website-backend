const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const NAVY = '#1a2a4f';
const GOLD = '#c9a227';
const GREY = '#6b7280';
const GREEN = '#15803d';

const VERIFY_BASE = process.env.VERIFY_URL || 'https://amarjyotischool.in/verify';

function inr(num) {
  let n = Math.round(Number(num || 0)).toString();
  let last3 = n.slice(-3);
  let rest = n.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + last3;
}
function fmtDate(d) {
  const dt = new Date(d);
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(dt.getDate()).padStart(2,'0')} ${m[dt.getMonth()]} ${dt.getFullYear()}`;
}

/**
 * @param {Object} data { nocNo, studentName, rollNumber, class, section,
 *                         academicYear, items:[{category, amount, paid}], grandTotal }
 */
async function generateNOC(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(res => doc.on('end', () => res(Buffer.concat(chunks))));

  const W = doc.page.width, M = 40;

  // QR
  const verifyUrl = `${VERIFY_BASE}/${encodeURIComponent(data.nocNo)}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220, color: { dark: NAVY, light: '#fff' } });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  // Header
  doc.rect(0, 0, W, 110).fill(NAVY);
  doc.rect(0, 110, W, 4).fill(GOLD);
  const logoPath = path.join(__dirname, '../assets/AJS_Logo.png');
  if (fs.existsSync(logoPath)) doc.image(logoPath, M, 22, { width: 66, height: 66 });
  doc.fill('#fff').font('Helvetica-Bold').fontSize(22).text('AMAR JYOTI SCHOOL', M + 80, 30);
  doc.fill(GOLD).font('Helvetica').fontSize(10).text('Gopalgarh, Pahari (Raj.)', M + 80, 58);
  doc.fill('#cbd5e1').fontSize(8).text('Email: Ajs.School@gmail.com   |   Phone: +91 9828603638', M + 80, 74);

  // Title
  doc.fill(GREEN).font('Helvetica-Bold').fontSize(16).text('NO OBJECTION CERTIFICATE (FEE)', M, 134, { width: W - 2 * M, align: 'center' });
  doc.fill(GREY).font('Helvetica').fontSize(9)
    .text(`Certificate No: ${data.nocNo}`, M, 162)
    .text(`Date: ${fmtDate(new Date())}`, W - M - 160, 162, { width: 160, align: 'right' });

  // Statement
  doc.fill('#111827').font('Helvetica').fontSize(10.5)
    .text(
      `This is to certify that the following student has cleared all outstanding fee dues with the school as on the date of issue. The school has no objection regarding the fee status of the student.`,
      M, 188, { width: W - 2 * M, align: 'justify', lineGap: 3 }
    );

  // Student card
  const cardY = 248;
  doc.roundedRect(M, cardY, W - 2 * M, 92, 6).fill('#f3f4f6');
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(10).text('STUDENT DETAILS', M + 16, cardY + 12);
  const col1 = M + 16, col2 = W / 2 + 10;
  const row = (label, val, x, y) => {
    doc.fill(GREY).font('Helvetica').fontSize(8.5).text(label, x, y);
    doc.fill('#111827').font('Helvetica-Bold').fontSize(10).text(val || '-', x, y + 11);
  };
  row('Name', data.studentName, col1, cardY + 34);
  row('Roll Number', data.rollNumber, col2, cardY + 34);
  row('Class / Section', data.section ? `${data.class} - ${data.section}` : `${data.class}`, col1, cardY + 62);
  row('Academic Year', data.academicYear, col2, cardY + 62);

  // Fee breakdown table
  const tY = cardY + 110;
  doc.rect(M, tY, W - 2 * M, 26).fill(NAVY);
  doc.fill('#fff').font('Helvetica-Bold').fontSize(9.5);
  doc.text('FEE CATEGORY', M + 16, tY + 8);
  doc.text('TOTAL (Rs.)', W / 2, tY + 8);
  doc.text('PAID (Rs.)', W - M - 100, tY + 8, { width: 90, align: 'right' });

  let rowY = tY + 26;
  data.items.forEach(it => {
    doc.rect(M, rowY, W - 2 * M, 26).fill('#fff').stroke('#e5e7eb');
    doc.fill('#111827').font('Helvetica').fontSize(10);
    doc.text(`${it.category}`, M + 16, rowY + 8);
    doc.text(inr(it.amount), W / 2, rowY + 8);
    doc.font('Helvetica-Bold').text(inr(it.paid), W - M - 100, rowY + 8, { width: 90, align: 'right' });
    rowY += 26;
  });

  // Total band
  doc.rect(M, rowY, W - 2 * M, 30).fill('#ecfdf5');
  doc.fill(GREEN).font('Helvetica-Bold').fontSize(11).text('TOTAL FEES PAID', M + 16, rowY + 9);
  doc.text(`Rs. ${inr(data.grandTotal)}`, W - M - 120, rowY + 9, { width: 110, align: 'right' });
  doc.fill(GREEN).font('Helvetica-Bold').fontSize(11).text('STATUS: ALL DUES CLEARED', M, rowY + 44, { width: W - 2 * M, align: 'center' });

  // QR + seal
  const qrSize = 92, qrX = W - M - qrSize, qrY = rowY + 80;
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fill(GREY).font('Helvetica').fontSize(7.5).text('Scan to verify', qrX - 6, qrY + qrSize + 4, { width: qrSize + 12, align: 'center' });

  const sealX = M + 70, sealY = qrY + 46, sealR = 42;
  doc.save();
  doc.lineWidth(1.5).strokeOpacity(0.8);
  doc.circle(sealX, sealY, sealR).stroke(GOLD);
  doc.circle(sealX, sealY, sealR - 6).dash(2, { space: 2 }).stroke(NAVY).undash();
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(7).text('VERIFIED', sealX - sealR + 6, sealY - 18, { width: (sealR - 6) * 2, align: 'center' });
  doc.fontSize(9).text('AJS', sealX - 12, sealY - 6, { width: 24, align: 'center' });
  doc.fill(GREY).fontSize(5.5).text('DIGITALLY GENERATED', sealX - sealR + 6, sealY + 14, { width: (sealR - 6) * 2, align: 'center' });
  doc.restore();

  doc.moveTo(M, qrY + qrSize + 2).lineTo(M + 150, qrY + qrSize + 2).stroke('#9ca3af');
  doc.fill(GREY).fontSize(8).text('Authorized Signatory (Accounts)', M, qrY + qrSize + 6);

  doc.rect(0, doc.page.height - 40, W, 40).fill(NAVY);
  doc.fill('#cbd5e1').font('Helvetica').fontSize(7)
    .text('This is a digitally generated certificate and does not require a physical signature. Verify at: ' + verifyUrl,
      M, doc.page.height - 28, { width: W - 2 * M, align: 'center' });

  doc.end();
  return done;
}

module.exports = { generateNOC };