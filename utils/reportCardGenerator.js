const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const NAVY = '#1a2a4f';
const GOLD = '#c9a227';
const GREY = '#6b7280';

function getGrade(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 40) return 'D';
  return 'E (Needs Improvement)';
}

async function generateReportCard(data) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(res => doc.on('end', () => res(Buffer.concat(chunks))));

  const W = doc.page.width;
  const M = 40;

  // Outer Premium Border
  doc.rect(15, 15, W - 30, doc.page.height - 30).lineWidth(2).stroke(NAVY);
  doc.rect(18, 18, W - 36, doc.page.height - 36).lineWidth(1).stroke(GOLD);

  // Circular Clipped Logo
  const logoPath = path.join(__dirname, '../assets/AJS_Logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      const logoR = 34;
      const logoCx = W / 2;
      const logoCy = 65;
      doc.circle(logoCx, logoCy, logoR).fill('#ffffff');
      doc.save();
      doc.circle(logoCx, logoCy, logoR).clip();
      doc.image(logoPath, logoCx - logoR, logoCy - logoR, { width: logoR * 2, height: logoR * 2 });
      doc.restore();
      doc.circle(logoCx, logoCy, logoR).lineWidth(1.5).stroke(GOLD);
    } catch (e) {
      console.error(e);
    }
  }

  // School Name & Header
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(22).text('AMAR JYOTI SCHOOL', M, 110, { align: 'center' });
  doc.fill(GREY).font('Helvetica').fontSize(9).text('Gopalgarh, Pahari (Raj.)', M, 135, { align: 'center' });

  // Title
  doc.fill(GOLD).font('Helvetica-Bold').fontSize(14).text('ACADEMIC REPORT CARD', M, 160, { align: 'center' });
  doc.fill(NAVY).font('Helvetica').fontSize(11).text(`${data.result.examName} | ${data.result.academicYear}`, M, 178, { align: 'center' });

  // Student Information Card
  const cardY = 210;
  doc.roundedRect(M, cardY, W - 2 * M, 65, 6).fill('#f8fafc').stroke('#e2e8f0');
  
  const col1 = M + 15, col2 = W / 2 + 10;
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(9.5);
  doc.text('Student Name:', col1, cardY + 15);
  doc.text('Roll Number:', col1, cardY + 35);
  doc.text('Class/Section:', col2, cardY + 15);
  doc.text('Parent Name:', col2, cardY + 35);

  doc.fill('#334155').font('Helvetica');
  doc.text(data.student.name, col1 + 80, cardY + 15);
  doc.text(data.student.rollNumber, col1 + 80, cardY + 35);
  doc.text(`${data.student.class} ${data.student.section || ''}`, col2 + 80, cardY + 15);
  doc.text(data.student.parentName || '-', col2 + 80, cardY + 35);

  // Subjects Table Header
  let tY = cardY + 85;
  doc.rect(M, tY, W - 2 * M, 25).fill(NAVY);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(9.5);
  doc.text('SUBJECT', M + 15, tY + 8);
  doc.text('MAX MARKS', M + 200, tY + 8);
  doc.text('OBTAINED', M + 300, tY + 8);
  doc.text('GRADE', M + 420, tY + 8);

  // Subjects Data
  let rowY = tY + 25;
  let totalMax = 0, totalObt = 0;

  data.result.subjects.forEach((sub, i) => {
    totalMax += (sub.totalMarks || 0);
    totalObt += (sub.marksObtained || 0);
    let pct = sub.totalMarks ? (sub.marksObtained / sub.totalMarks) * 100 : 0;
    
    doc.rect(M, rowY, W - 2 * M, 25).fill(i % 2 === 0 ? '#ffffff' : '#f8fafc').stroke('#e2e8f0');
    doc.fill('#334155').font('Helvetica-Bold').text(sub.subject, M + 15, rowY + 8);
    doc.font('Helvetica').text(sub.totalMarks.toString(), M + 200, rowY + 8);
    doc.text(sub.marksObtained.toString(), M + 300, rowY + 8);
    doc.fill(NAVY).font('Helvetica-Bold').text(getGrade(pct), M + 420, rowY + 8);
    rowY += 25;
  });

  // Totals Row
  doc.rect(M, rowY, W - 2 * M, 30).fill('#eef2ff');
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(10);
  doc.text('OVERALL TOTAL', M + 15, rowY + 10);
  doc.text(totalMax.toString(), M + 200, rowY + 10);
  doc.text(totalObt.toString(), M + 300, rowY + 10);
  rowY += 50;

  // Final Assessment Box
  const overallPct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
  doc.roundedRect(M, rowY, W - 2 * M, 50, 6).fill('#ffffff').stroke('#e2e8f0');
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(10);
  doc.text('OVERALL PERCENTAGE:', M + 15, rowY + 15);
  doc.fill('#10b981').text(`${overallPct.toFixed(1)}%`, M + 150, rowY + 15);

  doc.fill(NAVY).font('Helvetica-Bold');
  doc.text('OVERALL GRADE:', W / 2 + 15, rowY + 15);
  doc.fill('#10b981').text(getGrade(overallPct), W / 2 + 120, rowY + 15);

  if (data.result.remark) {
    doc.fill(GREY).font('Helvetica').fontSize(9).text(`Remarks: ${data.result.remark}`, M + 15, rowY + 32);
  }

  // Footer Signatures
  rowY += 100;
  doc.moveTo(M + 40, rowY).lineTo(M + 180, rowY).stroke('#9ca3af');
  doc.fill(NAVY).font('Helvetica-Bold').fontSize(9).text('Class Teacher', M + 75, rowY + 8);

  doc.moveTo(W - M - 180, rowY).lineTo(W - M - 40, rowY).stroke('#9ca3af');
  doc.text('Principal', W - M - 130, rowY + 8);

  doc.end();
  return done;
}

module.exports = { generateReportCard };