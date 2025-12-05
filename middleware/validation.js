const validateVideo = (req, res, next) => {
  const { base64Data, mimetype, filename, fileSize } = req.body;

  if (!base64Data || !mimetype || !filename || !fileSize) {
    return res.status(400).json({ error: "Missing required video fields" });
  }

  if (fileSize > 50 * 1024 * 1024) {
    // 50MB
    return res.status(400).json({ error: "File size exceeds 50MB limit" });
  }

  const allowedTypes = ["video/mp4", "video/quicktime", "video/x-msvideo"];
  if (!allowedTypes.includes(mimetype)) {
    return res.status(400).json({ error: "Unsupported video format" });
  }

  next();
};

module.exports = { validateVideo };
