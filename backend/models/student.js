const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNo: { type: String, required: true, unique: true },
  embeddings: { type: [Number], required: true },
});

module.exports = mongoose.models.Student || mongoose.model('Student', studentSchema);
