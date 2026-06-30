export default function ReceiptHiddenInputs({ backupFileRef, onBackupFile, onReceiptFiles, onCameraFiles }) {
  const handleFiles = (event, callback) => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (files.length) callback(files);
  };

  return (
    <>
      <input ref={backupFileRef} type="file" accept=".json" className="hidden" onChange={onBackupFile} />
      <input
        id="file-i"
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFiles(event, onReceiptFiles)}
      />
      <input
        id="cam-i"
        type="file"
        capture="environment"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFiles(event, onCameraFiles)}
      />
    </>
  );
}
