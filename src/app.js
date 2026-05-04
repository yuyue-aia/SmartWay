const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');
const healthRoutes = require('./routes/health.routes');
const childrenRoutes = require('./routes/children.routes');
const githubRoutes = require('./routes/github.routes');
const notFound = require('./middleware/not-found');
const errorHandler = require('./middleware/error-handler');

const app = express();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

app.use('/api', healthRoutes);
app.use('/api', childrenRoutes);
app.use('/api', githubRoutes);

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(config.rootDir, 'index.html'));
});

app.use('/homework', express.static(config.homeworkDir, { index: 'index.html' }));
app.use('/shared', express.static(config.sharedDir));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
