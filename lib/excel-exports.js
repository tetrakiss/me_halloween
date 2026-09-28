const ExcelJS = require('exceljs');

const HEADER_FILL = 'FF211335';
const HEADER_ACCENT = 'FFFF7A1A';
const BORDER_COLOR = 'FFE5DDEC';
const ALT_ROW_FILL = 'FFFFF8F1';

function prepareWorksheet(workbook, name, columns) {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  worksheet.columns = columns;
  worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(columns.length).letter}1` };
  worksheet.getRow(1).height = 28;
  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: HEADER_ACCENT } } };
  });
  return worksheet;
}

function finishWorksheet(worksheet) {
  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: BORDER_COLOR } } };
      if (rowIndex % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_FILL } };
      }
    });
  }
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Монстрополия';
  workbook.company = 'Монстрополия';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}

async function participantsWorkbookBuffer(participants) {
  const workbook = createWorkbook();
  const worksheet = prepareWorksheet(workbook, 'Участники', [
    { header: 'Ребёнок', key: 'childName', width: 24 },
    { header: 'Возраст', key: 'age', width: 11 },
    { header: 'Башня', key: 'tower', width: 24 },
    { header: 'Этаж', key: 'floor', width: 10 },
    { header: 'Квартира', key: 'apartmentCode', width: 13 },
    { header: 'Код семьи', key: 'familyCode', width: 14 },
    { header: 'Группа', key: 'groupName', width: 22 },
    { header: 'Идёт в обход', key: 'walking', width: 15 },
    { header: 'Приём гостей', key: 'hostingType', width: 22 },
    { header: 'Статус анкеты', key: 'status', width: 17 },
  ]);
  worksheet.addRows(participants);
  finishWorksheet(worksheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function routesWorkbookBuffer(routeRows) {
  const workbook = createWorkbook();
  const worksheet = prepareWorksheet(workbook, 'Маршруты', [
    { header: 'Группа', key: 'groupName', width: 22 },
    { header: 'Детей', key: 'childCount', width: 10 },
    { header: 'Семьи группы', key: 'memberFamilies', width: 38 },
    { header: 'Дети группы', key: 'memberChildren', width: 42 },
    { header: 'Этап', key: 'stage', width: 9 },
    { header: 'Тип точки', key: 'stopType', width: 19 },
    { header: 'Название', key: 'displayName', width: 24 },
    { header: 'Башня', key: 'tower', width: 24 },
    { header: 'Этаж', key: 'floor', width: 10 },
    { header: 'Квартира', key: 'apartmentCode', width: 13 },
    { header: 'Прибытие, мин', key: 'arrivalMin', width: 16 },
    { header: 'Убытие, мин', key: 'departureMin', width: 16 },
  ]);
  worksheet.addRows(routeRows);
  finishWorksheet(worksheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { participantsWorkbookBuffer, routesWorkbookBuffer };
