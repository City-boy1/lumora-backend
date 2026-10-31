const whiteList = [
    'http://localhost:5173',
];

const corsOps = {
    origin: (origin, callback) => {
        if (whiteList.includes(origin) || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials:true,
    optionsSuccessStatus: 200
};

module.exports = corsOps;