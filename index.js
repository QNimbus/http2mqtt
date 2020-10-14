const mqtt = require('mqtt');
const express = require('express');
const bodyParser = require('body-parser');
const expAutoSan = require('express-autosanitizer');

var app = express();

var settings = {
    mqtt: {
        host: process.env.MQTT_HOST || '',
        user: process.env.MQTT_USER || '',
        password: process.env.MQTT_PASS || '',
        clientId: process.env.MQTT_CLIENT_ID || null
    },
    debug: process.env.DEBUG_MODE || false,
    auth_key: process.env.AUTH_KEY || '',
    http_port: process.env.PORT || 5000
}

function getMqttClient() {

    var options = {
        username: settings.mqtt.user,
        password: settings.mqtt.password
    };

    if (settings.mqtt.clientId) {
        options.clientId = settings.mqtt.clientId
    }

    return mqtt.connect(settings.mqtt.host, options);
}

var mqttClient = getMqttClient();

app.set('port', settings.http_port);
app.use(bodyParser.json());
app.use(expAutoSan.all);

function logRequest(req, res, next) {
    var ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;
    var message = 'Received request [' + req.originalUrl +
        '] from [' + ip + ']';

    if (settings.debug) {
        message += ' with payload [' + JSON.stringify(req.body) + ']';
    } else {
        message += '.';
    }
    console.log(message);

    next();
}

function authorizeUser(req, res, next) {
    const key = req.autosan.body['key'] || req.autosan.query['key']
    if (settings.auth_key && key != settings.auth_key) {
        console.log('Request is not authorized.');
        res.sendStatus(401);
    }
    else {
        next();
    }
}

function checkMessagePathQueryParameter(req, res, next) {
    if (req.query.path) {
        req.body.message = req.body[req.query.path];
    }
    next();
}

function checkTopicQueryParameter(req, res, next) {

    if (req.query.topic) {
        req.body.topic = req.query.topic;
    }

    next();
}

function ensureTopicSpecified(req, res, next) {
    if (!req.body.topic) {
        res.status(500).send('Topic not specified');
    }
    else {
        next();
    }
}

app.get('/post/*', logRequest, authorizeUser, function (req, res) {
    // Trim leading and trailing '/' and remove first part of path
    topic = req.path.split('/').slice(2).join('/').replace(/^\/+|\/+$/g, '')
    message = req.autosan.query['message']
    qos = parseInt(req.autosan.query['qos']) || 0
    retain = String(req.autosan.query['retain']).toLowerCase() === 'true' || false

    mqttClient.publish(topic, message, { qos, retain });
    res.sendStatus(200)
});

app.post('/post/', logRequest, authorizeUser, checkMessagePathQueryParameter, checkTopicQueryParameter, ensureTopicSpecified, function (req, res) {
    mqttClient.publish(req.body['topic'], req.body['message']);
    res.sendStatus(200);
});

app.get('/subscribe/', logRequest, authorizeUser, function (req, res) {

    var topic = req.query.topic;

    if (!topic) {
        res.status(500).send('topic not specified');
    }
    else {
        // get a new mqttClient
        // so we dont constantly add listeners on the 'global' mqttClient
        var mqttClient = getMqttClient();

        mqttClient.on('connect', function () {
            mqttClient.subscribe(topic);
        });

        mqttClient.on('message', function (t, m) {
            if (t === topic) {
                res.write(m);
            }
        });

        req.on("close", function () {
            mqttClient.end();
        });

        req.on("end", function () {
            mqttClient.end();
        });
    }
});

app.listen(app.get('port'), function () {
    console.log('Node app is running on port', app.get('port'));
});
