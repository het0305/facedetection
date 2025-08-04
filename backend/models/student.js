const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNo: { type: String, required: true, unique: true },
  embeddings: { type: [Number], required: true } // Face descriptor array
});

module.exports = mongoose.model('Student', studentSchema);

