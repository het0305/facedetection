const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '../records/AttendanceRecords.xlsx');

async function updateExcel(attendanceList) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Attendance');

  // Header row
  sheet.columns = [
    { header: 'Student Name', key: 'name', width: 30 },
    { header: 'Roll Number', key: 'rollNo', width: 20 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Date & Time', key: 'date', width: 30 },
    { header: 'Image', key: 'image', width: 40 },
  ];

  // Add attendance records
  attendanceList.forEach((record) => {
    sheet.addRow({
      name: record.studentId.name,
      rollNo: record.studentId.rollNo,
      status: record.status,
      date: new Date(record.date).toLocaleString(),
      image: record.image,
    });
  });

  // Create records folder if not exist
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  // Save file
  await workbook.xlsx.writeFile(FILE_PATH);
  console.log('✅ Excel file updated.');
}

module.exports = { updateExcel };
