const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./utils/logger');

mongoose.set('strictQuery', true);

async function connect(uri = config.MONGO_URI) {
  // Indexes are created explicitly after migrations (see migrations/index.js).
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { err }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
}

const disconnect = () => mongoose.disconnect();

module.exports = { connect, disconnect };
