const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const NAVY = '#1a2a4f';
const GOLD = '#c9a227';
const GREY = '#6b7280';

// Verification base URL (frontend route that calls /verify-receipt/:receiptNo)
const VERIFY_BASE = process.env.VERIFY_URL || 'https://amarjyoti.school/verify';

// Reliable Indian number formatting (e.g. 1,00,000) — no locale dependency
function inr(num) {
  let n = Math.round(Number(num || 0)).toString();
  let last3 = n.slice(-3);
  let rest = n.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + last3;
}

// Reliable date formatting (dd Mon yyyy) — no locale dependency
function fmtDate(d) {
  const dt = new Date(d);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(dt.getDate()).padStart(2, '0')} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

/**
 * Generates a fee receipt PDF buffer.
 * @param {Object} data { receiptNo, studentName, rollNumber, class, section,
 *                         category, academicYear, amount, mode, date, collectedBy,
 *                         totalFee, paidTillDate, balance }
 * @returns {Promise<Buffer>}
 */
async function generateReceipt(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const W = doc.page.width;   // 595.28
  const M = 40;               // content margin

  // --- QR code (verification link) ---
  const verifyUrl = `${VERIFY_BASE}/${encodeURIComponent(data.receiptNo)}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1, width: 220, color: { dark: NAVY, light: '#ffffff' },
  });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  // ===== HEADER BAND =====
  doc.rect(0, 0, W, 110).fill(NAVY);
  doc.rect(0, 110, W, 4).fill(GOLD);

  // Logo (left)
 const logoPath = path.join(__dirname, '../assets/AJS_Logo.png');
console.log('Logo path:', logoPath, '| Exists:', fs.existsSync(logoPath));
if (fs.existsSync(logoPath)) {
  try {
    doc.image(logoPath, M, 22, { width: 66, height: 66 });
  } catch (e) {
    console.error('Logo render error:', e.message);
  }
}

  // School name (center-left)
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(22)
    .text('AMAR JYOTI SCHOOL', M + 80, 30);
  doc.fill(GOLD).font('Helvetica').fontSize(10)
    .text('Knowledge · Discipline · Excellence', M + 80, 58);
  doc.fill('#cbd5e1').fontSize(8)
    .text('Email: office@amarjyoti.school   |   Affiliation No: XXXXXXX', M + 80, 74);

  // ===== TITLE =====
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(15)
    .text('FEE PAYMENT RECEIPT', M, 134, { align: 'left' });
  doc.fill(GREY).font('Helvetica').fontSize(9)
    .text(`Receipt No: ${data.receiptNo}`, M, 156)
    .text(`Date: ${fmtDate(data.date)}`, M, 168);

  // ===== STUDENT DETAILS CARD =====
  const cardY = 192;
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

  // ===== PAYMENT TABLE =====
  const tY = cardY + 110;
  doc.rect(M, tY, W - 2 * M, 26).fill(NAVY);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(9.5);
  doc.text('PARTICULARS', M + 16, tY + 8);
  doc.text('PAYMENT MODE', W / 2 - 30, tY + 8);
  doc.text('AMOUNT (Rs.)', W - M - 100, tY + 8, { width: 90, align: 'right' });

  const rY = tY + 26;
  doc.rect(M, rY, W - 2 * M, 30).fill('#ffffff').stroke('#e5e7eb');
  doc.fill('#111827').font('Helvetica').fontSize(10);
  doc.text(`${data.category} Fee`, M + 16, rY + 10);
  doc.text(data.mode, W / 2 - 30, rY + 10);
  doc.font('Helvetica-Bold').text(inr(data.amount), W - M - 100, rY + 10, { width: 90, align: 'right' });

  // Total band
  const totY = rY + 30;
  doc.rect(M, totY, W - 2 * M, 30).fill('#eef2ff');
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(11)
    .text('AMOUNT PAID', M + 16, totY + 9);
  doc.text(`Rs. ${inr(data.amount)}`, W - M - 120, totY + 9, { width: 110, align: 'right' });

  // ===== FEE SUMMARY (optional balances) =====
  let sY = totY + 50;
  if (data.totalFee != null) {
    doc.fill(GREY).font('Helvetica').fontSize(9);
    doc.text(`Total Fee: Rs. ${inr(data.totalFee)}`, M, sY);
    doc.text(`Paid Till Date: Rs. ${inr(data.paidTillDate || 0)}`, M, sY + 14);
    doc.fill(Number(data.balance) > 0 ? '#b91c1c' : '#15803d').font('Helvetica-Bold')
      .text(`Balance: Rs. ${inr(data.balance || 0)}`, M, sY + 28);
    sY += 50;
  }

  // ===== QR + VERIFICATION =====
  const qrSize = 92;
  const qrX = W - M - qrSize;
  const qrY = sY + 10;
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fill(GREY).font('Helvetica').fontSize(7.5)
    .text('Scan to verify authenticity', qrX - 6, qrY + qrSize + 4, { width: qrSize + 12, align: 'center' });

  // ===== DIGITAL SEAL (generated) =====
  const sealX = M + 70, sealY = qrY + 46, sealR = 42;
  doc.save();
  doc.lineWidth(1.5).strokeOpacity(0.8);
  doc.circle(sealX, sealY, sealR).stroke(GOLD);
  doc.circle(sealX, sealY, sealR - 6).dash(2, { space: 2 }).stroke(NAVY).undash();
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(7)
    .text('VERIFIED', sealX - sealR + 6, sealY - 18, { width: (sealR - 6) * 2, align: 'center' });
  doc.fontSize(9).text('AJS', sealX - 12, sealY - 6, { width: 24, align: 'center' });
  doc.fill(GREY).fontSize(5.5)
    .text('DIGITALLY GENERATED', sealX - sealR + 6, sealY + 14, { width: (sealR - 6) * 2, align: 'center' });
  doc.restore();

  // Signature line
  doc.moveTo(M, qrY + qrSize + 2).lineTo(M + 150, qrY + qrSize + 2).stroke('#9ca3af');
  doc.fill(GREY).fontSize(8).text(`Authorized Signatory${data.collectedBy ? ' / ' + data.collectedBy : ''}`, M, qrY + qrSize + 6);

  // ===== FOOTER =====
  doc.rect(0, doc.page.height - 40, W, 40).fill(NAVY);
  doc.fill('#cbd5e1').font('Helvetica').fontSize(7)
    .text('This is a digitally generated receipt and does not require a physical signature. Verify at: ' + verifyUrl,
      M, doc.page.height - 28, { width: W - 2 * M, align: 'center' });

  doc.end();
  return done;
}

module.exports = { generateReceipt };