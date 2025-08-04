const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNo: { type: String, required: true, unique: true },
  embeddings: { type: [Number], required: true }
});

// Use existing model if already compiled
module.exports = mongoose.models.Student || mongoose.model('Student', studentSchema);
