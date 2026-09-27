/**
 * Photo Frame Studio — Google Apps Script Backend (Code.gs)
 * ==============================================================
 * สคริปต์สำหรับเชื่อมต่อ Photo Frame Studio กับ Google Drive และ Google Sheets
 * 
 * ความสามารถ:
 * 1. รับไฟล์รูปภาพ (Original, Finished, Activity, Frame) จาก Frontend
 * 2. สร้างโฟลเดอร์แยกหมวดหมู่อัตโนมัติบน Google Drive
 * 3. บันทึกประวัติและ Log ข้อมูลลง Google Sheets อัตโนมัติ
 * 4. รองรับ CORS และ Health Check สำหรับทดสอบการเชื่อมต่อ
 */

// ชื่อโฟลเดอร์หลักบน Google Drive
var ROOT_FOLDER_NAME = "Photo Frame Studio";

// ชื่อโฟลเดอร์ย่อยตามประเภทไฟล์
var SUB_FOLDERS = {
  "original": "Original Photos",
  "finished": "Finished Images",
  "activity": "Activity Images",
  "frame": "Frames",
  "other": "Uploads"
};

/**
 * Health Check & Test Endpoint (GET)
 */
function doGet(e) {
  var output = {
    ok: true,
    status: "active",
    message: "Photo Frame Studio — Google Drive Backend พร้อมใช้งาน",
    timestamp: new Date().toISOString()
  };
  return createJsonResponse(output);
}

/**
 * Upload & Process Endpoint (POST)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ ok: false, error: "ไม่พบข้อมูลส่งมา (No post data)" });
    }

    var payload = JSON.parse(e.postData.contents);
    var type = payload.type || "other";
    var filename = payload.filename || ("photo_" + new Date().getTime() + ".png");
    var mimeType = payload.mimeType || "image/png";
    var dataBase64 = payload.dataBase64;

    if (!dataBase64) {
      return createJsonResponse({ ok: false, error: "ไม่พบข้อมูลรูปภาพ (Missing dataBase64)" });
    }

    // 1. แปลง Base64 เป็น Blob
    var bytes = Utilities.base64Decode(dataBase64);
    var blob = Utilities.newBlob(bytes, mimeType, filename);

    // 2. ค้นหาหรือสร้าง Root Folder และ Sub Folder
    var rootFolder = getOrCreateFolder(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
    var subFolderName = SUB_FOLDERS[type] || SUB_FOLDERS["other"];
    var targetFolder = getOrCreateFolder(rootFolder, subFolderName);

    // 3. บันทึกไฟล์ลง Google Drive
    var file = targetFolder.createFile(blob);

    // หากเป็นภาพกิจกรรม หรือกรอบรูป เปิดสิทธิ์ให้อ่านผ่านลิงก์ได้สำหรับแสดงผล
    if (type === "activity" || type === "frame" || type === "finished") {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }

    var fileId = file.getId();
    var viewUrl = file.getUrl();
    var directUrl = "https://lh3.googleusercontent.com/d/" + fileId;

    // 4. บันทึกประวัติลง Google Sheet อัตโนมัติ
    try {
      logToSheet(rootFolder, {
        timestamp: new Date(),
        type: type,
        filename: filename,
        frameName: payload.frameName || "-",
        caption: payload.caption || "-",
        fileId: fileId,
        viewUrl: viewUrl
      });
    } catch (logErr) {
      Logger.log("Log to sheet error: " + logErr);
    }

    return createJsonResponse({
      ok: true,
      fileId: fileId,
      url: viewUrl,
      directUrl: directUrl,
      message: "บันทึกไฟล์ลง Google Drive เรียบร้อยแล้ว"
    });

  } catch (err) {
    return createJsonResponse({
      ok: false,
      error: "เกิดข้อผิดพลาดในการประมวลผล: " + err.toString()
    });
  }
}

/**
 * ฟังก์ชันค้นหาโฟลเดอร์ หากยังไม่มีจะสร้างใหม่ให้อัตโนมัติ
 */
function getOrCreateFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(folderName);
}

/**
 * บันทึกรายการลง Google Spreadsheet เพื่อเป็นประวัติการใช้งาน
 */
function logToSheet(rootFolder, item) {
  var sheetName = "Photo_Log";
  var files = rootFolder.getFilesByName(sheetName);
  var spreadsheet;

  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
  } else {
    spreadsheet = SpreadsheetApp.create(sheetName);
    var sheetFile = DriveApp.getFileById(spreadsheet.getId());
    rootFolder.addFile(sheetFile);
    DriveApp.getRootFolder().removeFile(sheetFile);

    var sheet = spreadsheet.getActiveSheet();
    sheet.appendRow(["วันเวลา (Timestamp)", "ประเภท (Type)", "ชื่อไฟล์ (Filename)", "ชื่อกรอบ (Frame)", "คำบรรยาย (Caption)", "File ID", "ลิงก์ไฟล์ (View URL)"]);
    sheet.getRange("A1:G1").setBackground("#0C4A45").setFontColor("#FFFFFF").setFontWeight("bold");
  }

  var activeSheet = spreadsheet.getActiveSheet();
  activeSheet.appendRow([
    item.timestamp,
    item.type,
    item.filename,
    item.frameName,
    item.caption,
    item.fileId,
    item.viewUrl
  ]);
}

/**
 * สร้าง Response แบบ JSON
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
