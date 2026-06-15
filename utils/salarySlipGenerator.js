const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const NAVY = '#1a2a4f';
const GOLD = '#c9a227';
const GREY = '#6b7280';

function inr(num) {
  let n = Math.round(Number(num || 0)).toString();
  let last3 = n.slice(-3);
  let rest = n.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + last3;
}

exports.generateSalarySlip = async (data) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 0, size: 'A4' });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            const W = doc.page.width;   // 595.28
            const M = 40;               // content margin
            
            const slipNo = `PAY-${data.month.replace('-', '')}-${String(data.slipId || '0000').slice(-5).toUpperCase()}`;

            // --- HEADER ---
            doc.rect(0, 0, W, 110).fill(NAVY);
            doc.rect(0, 110, W, 4).fill(GOLD);

            const logoPath = path.join(__dirname, '../assets/AJS_Logo.png');
            if (fs.existsSync(logoPath)) {
                try {
                    const logoR = 34; const logoCx = M + logoR; const logoCy = 22 + logoR;
                    doc.circle(logoCx, logoCy, logoR).fill('#ffffff');
                    doc.save(); doc.circle(logoCx, logoCy, logoR).clip();
                    doc.image(logoPath, M, 22, { width: logoR * 2, height: logoR * 2 });
                    doc.restore();
                    doc.circle(logoCx, logoCy, logoR).lineWidth(1.5).stroke(GOLD);
                } catch (e) { console.error('Logo render error:', e.message); }
            }

            // School name
            doc.fill('#ffffff').font('Helvetica-Bold').fontSize(22).text('AMAR JYOTI SCHOOL', M + 80, 30);
            doc.fill(GOLD).font('Helvetica').fontSize(10).text('Knowledge · Discipline · Excellence', M + 80, 58);
            doc.fill('#cbd5e1').fontSize(8).text('Email: amarjyotividhyapeeth150@gmail.com   |   Phone: +91 9828603638, 9828142526, 7877443404', M + 80, 74);

            // --- TITLE & DATE ---
            doc.fill(NAVY).font('Helvetica-Bold').fontSize(15).text('SALARY SLIP', M, 134, { align: 'left' });
            doc.fill(GREY).font('Helvetica').fontSize(9)
               .text(`Payslip No: ${slipNo}`, M, 156)
               .text(`Month: ${data.month}`, M, 168)
               .text(`Generated On: ${new Date().toLocaleDateString()}`, M, 180);

            // --- EMPLOYEE DETAILS ---
            const startY = 204;
            doc.rect(50, startY, 495, 80).fillAndStroke('#f8fafc', '#e2e8f0');
            doc.fillColor('#1f2937').font('Helvetica-Bold').text('EMPLOYEE DETAILS', 60, startY + 10);
            
            doc.font('Helvetica').fontSize(10);
            doc.text(`Name: ${data.staffName || '-'}`, 60, startY + 30);
            doc.text(`Employee ID: ${data.employeeId || '-'}`, 60, startY + 45);

            doc.text(`Joined: ${data.joiningDate || '-'}`, 300, startY + 30);
            doc.text(`Status: ${data.status || '-'}`, 300, startY + 45);

            // --- EARNINGS & DEDUCTIONS ---
            const tableY = startY + 110;
            doc.rect(M, tableY, W - 2 * M, 26).fill(NAVY);
            
            doc.fill('#ffffff').font('Helvetica-Bold').fontSize(9.5);
            doc.text('PARTICULARS', M + 16, tableY + 8);
            doc.text('AMOUNT (Rs.)', W - M - 100, tableY + 8, { width: 90, align: 'right' });

            let rY = tableY + 26;
            doc.rect(M, rY, W - 2 * M, 93).fill('#ffffff').stroke('#e5e7eb');
            
            doc.fill('#111827').font('Helvetica').fontSize(10);
            doc.text('Basic Salary', M + 16, rY + 10);
            doc.text(inr(data.basicSalary), W - M - 100, rY + 10, { width: 90, align: 'right' });
            
            doc.text('Allowances / Bonus', M + 16, rY + 28);
            doc.text(inr(data.allowances), W - M - 100, rY + 28, { width: 90, align: 'right' });
            
            doc.text('Arrears', M + 16, rY + 46);
            doc.text(inr(data.arrears), W - M - 100, rY + 46, { width: 90, align: 'right' });

            doc.fill('#ef4444').font('Helvetica').fontSize(10);
            doc.text('Leaves / Other Deductions', M + 16, rY + 64);
            doc.text(`-${inr(data.deductions)}`, W - M - 100, rY + 64, { width: 90, align: 'right' });

            doc.fill('#111827').font('Helvetica-Bold').fontSize(10);
            doc.text('Net Salary', M + 16, rY + 82);
            doc.text(inr(data.netSalary), W - M - 100, rY + 82, { width: 90, align: 'right' });

            // --- NET PAYABLE ---
            let totY = rY + 93;
            doc.rect(M, totY, W - 2 * M, 30).fill('#eef2ff');
            doc.fill(NAVY).font('Helvetica-Bold').fontSize(11);
            doc.text('NET PAYABLE SALARY', M + 16, totY + 9);
            doc.text(`Rs. ${inr(data.netSalary)}`, W - M - 120, totY + 9, { width: 110, align: 'right' });

            // --- DIGITAL SEAL & FOOTER ---
            let sY = totY + 70;
            const sigY = sY + 80; 
            
            const sealR = 40; const sealX = W - M - 50; const sealY = sigY - 20; 
            doc.save(); doc.lineWidth(1.5).strokeOpacity(0.8);
            doc.circle(sealX, sealY, sealR).stroke(GOLD);
            doc.circle(sealX, sealY, sealR - 6).dash(2, { space: 2 }).stroke(NAVY).undash();
            doc.fill(NAVY).font('Helvetica-Bold').fontSize(7).text('VERIFIED', sealX - sealR + 6, sealY - 18, { width: (sealR - 6) * 2, align: 'center' });
            doc.fontSize(9).text('AJS', sealX - 12, sealY - 6, { width: 24, align: 'center' });
            doc.fill(GREY).fontSize(5.5).text('DIGITALLY GENERATED', sealX - sealR + 6, sealY + 14, { width: (sealR - 6) * 2, align: 'center' });
            doc.restore();

            // E-Signature (Stylized Text)
            doc.fill('#1e40af').font('Times-Italic').fontSize(14).text('Amar Jyoti School HR', M + 5, sigY - 20);

            doc.moveTo(M, sigY).lineTo(M + 150, sigY).stroke('#9ca3af');
            doc.fill(GREY).font('Helvetica-Bold').fontSize(8.5).text('Authorized Signatory (HR)', M, sigY + 6);

            doc.rect(0, doc.page.height - 40, W, 40).fill(NAVY);
            doc.fill('#cbd5e1').font('Helvetica').fontSize(7).text('This is a computer generated document and requires no signature.', M, doc.page.height - 28, { width: W - 2 * M, align: 'center' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};