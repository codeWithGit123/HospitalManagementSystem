// Importing The Required Modules
const express = require('express');
const db = require('./connection');
const multer = require('multer');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
var genAI = new GoogleGenerativeAI(process.env.API_KEY);
const PdfParse = require('pdf-parse');
const fs = require('fs');
const session = require('express-session');
require('dotenv').config();

// Creating an Express App
const app = express();
const port = 3000;

//Defining Middlewares
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//using expres-session middleware
app.use(session({
    secret: 'hello_world',  // Replace with a secure key
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }  // Set to true if using HTTPS
}));


//Image or File Upload using Multer
const storage = multer.diskStorage({
    destination: './uploads',
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});


//upload object for file uploads
const upload = multer({ storage: storage });


//Defining Routes
app.get('/', (req, res) => {
    res.render('index', { err: "" });
})

//Signup - Method Post for patient only
app.post('/signup', (req, res) => {
    const { uname, pass, role } = req.body;

    // Check if user already exists
    const checkUserSql = 'SELECT * FROM User WHERE username = ?';
    db.query(checkUserSql, [uname], async (err, result) => {
        if (err) throw err;

        if (result.length > 0) {
            return res.render("index", { err: 'User already exists' });
        }
        req.session.user = {
            username: uname,
            role: role
        };
        const sql = 'INSERT INTO User (username, password, role) VALUES (?, ?, ?)';
        db.query(sql, [uname, pass, role], (err, result) => {
            if (err) throw err;
            res.render("patient", { ulname: uname });
        });
    });
});

//Login Route for already present users
app.post('/login', (req, res) => {
    const { ulname, ulpass, urole } = req.body;

    const sql = 'SELECT username, password, role FROM User WHERE username = ?;';
    db.query(sql, [ulname], (err, result) => {
        if (err) {
            console.error(err);
            return res.render("index", { err: "Database error" });
        }

        if (result.length === 0) {
            return res.render("index", { err: "User not found" });
        }

        const user = result[0];

        if (urole !== user.role) {
            return res.render("index", { err: "Role does not match" });
        }

        if (ulpass === user.password) {

            switch (urole) {
                case 'admin':
                    {
                        req.session.user = {
                            username: user.username,
                            role: user.role
                        };
                        const s = "select d.name,d.doc_id,concat(p.fname,' ',p.lname) as Name,p.p_id,ap.email,ap.app_date,ap.app_time from appointment ap inner join patient p on ap.pat_id = p.p_id inner join doctor d on ap.doct_id = d.doc_id;";
                        db.query(s, (err, result) => {
                            if (err) {
                                console.error(err);
                                return res.render("admin", { err: "Database error" });
                            }
                            res.render("admin", { ulname: req.session.user.username, result });
                        });
                    }
                    break;
                case 'doctor':
                    {
                        const s = "select name,spec,qualifications,doc_id from doctor where uname = ?;";
                        db.query(s, [ulname], (err, result) => {
                            if (err) {
                                console.error(err);
                                return res.render("doctor", { err: "Database error" });
                            }
                            if (result.length === 0) {
                                return res.render("doctor", { err: "No data found" });
                            }
                            req.session.user = {
                                username: user.username,
                                role: user.role,
                                spec: result[0].spec,
                                qual: result[0].qualifications,
                                did: result[0].doc_id
                            };
                            const doctorDetails = result[0];
                            console.log(doctorDetails)
                            const appointmentsSql = `select p.p_id,concat(p.fname,' ',p.lname) as Name, p.gender,Year(curdate())-Year(p.dob) as Age,ap.app_date,ap.meet_link,ap.app_time,med.url,med.summary from patient p
                                inner join  appointment ap on ap.pat_id = p.p_id
                                inner join medicalrecord med on med.pat_id = p.p_id
                                where ap.doct_id =?`;
                            db.query(appointmentsSql, [doctorDetails.doc_id], (err, appointments) => {
                                if (err) {
                                    console.error(err);
                                    return res.render("doctor", { err: "Database error" });
                                }
                                console.log(appointments[0])
                                res.render('doctor', { result: result[0], r: appointments });
                            });
                        });
                    }
                    break;
                case 'receptionist':
                    req.session.user = {
                        username: user.username,
                        role: user.role,
                    };
                    res.render('pres', { uname: ulname });
                    break;
                case 'patient':
                    req.session.user = {
                        username: user.username,
                        role: user.role
                    };
                    const s = `select d.name , d.doc_id ,p.p_id, d.spec ,ap.meet_link ,ap.app_date ,ap.app_time from 
                    doctor d inner join appointment ap on d.doc_id = ap.doct_id
                    inner join patient p on ap.pat_id = p.p_id 
                    where concat(p.fname,' ',p.lname) ="${req.session.user.username}";`;
                    console.log(req.session.user.username)
                    db.query(s, (err, result) => {
                      if (err) {
                            console.error(err);
                            return res.render("patient", { ulname: req.session.user.username, err: "Database error" });
                        }
                        console.log(result)
                        res.render('patient', { ulname: req.session.user.username, result });
                    });
                    break;
                default:
                    res.render('index', { err: 'Invalid role' });
            }
        } else {
            res.render("index", { err: "Wrong Password" });
        }
    });
});


//Appointment Booking Route1 , selecting of doctor
app.get('/appt', (req, res) => {
    const query = 'SELECT doc_id, name FROM Doctor';
    db.query(query, (err, results) => {
        if (err) throw err;
        res.render('appt', { doctors: results });
    });
});

//logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

//reading summary and giving prescription
app.get('/dpres/:id', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    const sql = `select summary from medicalrecord where pat_id=${req.params.id}`;
    db.query(sql, (err, result) => {
        if (err) throw err;
        res.render('dpres', { r: result[0] });
    });
});


//Giving Feedback
app.get('/fe/:id', (req, res) => {
    const sql = `select concat(p.fname,' ',p.lname) as Name ,f.liked ,f.improvements,f.rate1,f.rate2 from patient p inner join feedback f on p.p_id =${req.params.id};
    `
    db.query(sql, (err, result) => {
        if (err) throw err;
        res.render('adfeed', { result: result[0] });
    })
})

//Posting Prescription into database
app.post('/pres', (req, res) => {
    const { pid, aid, med, dos, inst } = req.body;
    const s = `select name from doctor where doc_id = (select doct_id from appointment where pat_id = ?);`;

    db.query(s, [parseInt(pid)], (err, result) => {
        if (err) throw err;

        const dname = result[0].name;
        console.log(dname);

        const sql = 'insert into prescription (appt_id, pat_id, medication, dosage, instruction, d_name) values (?, ?, ?, ?, ?, ?);';
        db.query(sql, [aid, pid, med, dos, inst, dname], (err, result) => {
            if (err) throw err;
            console.log(dname);
            res.redirect('/');
        });
    });
});

//Deleting the appointment
app.get('/delapp/:pid', (req, res) => {
    const s = `delete from appointment where pat_id = ${req.params.pid};`;
    db.query(s, (err, result) => {
        if (err) throw err;
        const s2 = "select d.name,d.doc_id,concat(p.fname,' ',p.lname) as Name,p.p_id,ap.email,ap.app_date,ap.app_time from appointment ap inner join patient p on ap.pat_id = p.p_id inner join doctor d on ap.doct_id = d.doc_id;";
        db.query(s2, (err, result) => {
            if (err) throw err;
            res.render("admin", { ulname: req.session.user.username, result });
        })
    })
})


//Getting prescription details
app.post('/presc', ensureAuthenticated, (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const id = req.body.pid;
    const sql = `select * from prescription where pat_id=${id}`;
    db.query(sql, (err, result) => {
        if (err) throw err;
        console.log(result)
        res.render('pres', { result: result[0], uname: req.session.user.username });
    });
})

//Function for image summarization to convert to a suitable format
function fileToGenPart(path, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(path)).toString('base64'),
            mimeType
        },
    };
}


//Booking Appointment route1 selecting doctor
app.post('/bapp', upload.single('document'), (req, res) => {
    const { fname, lname, email, dob, gender, app_date, app_time } = req.body;
    const doc_id = req.body.doct_id;
    var patient_id = req.body.patientId;
    const document_url = req.file.filename;
    const mt = req.file.mimetype;
    const pdfPath = req.file.path;
    const date = new Date();
    const link = "https://meet.google.com/ppz-bfup-zdb";
    console.log(mt);

    const s = 'insert into patient (fname,lname,dob,gender) values(?,?,?,?)';
    db.query(s, [fname, lname, dob, gender], (err, result) => {
        if (err) throw err;
        patient_id = result.insertId;
        console.log(patient_id);

    })
    if (mt != 'image/png' && mt != 'image/jpeg' && mt != 'image/jpg') {
        console.log(mt)
        fs.readFile(pdfPath, (err, data) => {
            if (err) throw err;
            PdfParse(data).then(async (pdfData) => {
                var v = await run(pdfData.text);
                console.log(v);
                const sql = 'INSERT INTO MedicalRecord (Pat_id,upload_date, url,summary) VALUES (?,?,?,?) ';
                db.query(sql, [patient_id, date, document_url, v], (err, result) => {
                    if (err) {
                        throw err;
                    }
                });
                const s1 = 'INSERT INTO appointment (app_date,app_time,pat_id,doct_id,email,meet_link) values (?,?,?,?,?,?)'
                db.query(s1, [app_date, app_time, patient_id, doc_id.split(',')[0], email,link], (err, result) => {
                    if (err) throw err;
                })
                res.redirect('/');
            });
        })
    }
    else {
        async function summ() {
            var s = await runImg(document_url);
            const sql = 'INSERT INTO MedicalRecord (Pat_id,upload_date, url,summary) VALUES (?,?,?,?) ';
            db.query(sql, [patient_id, date, document_url, s], (err, result) => {
                if (err) {
                    throw err;
                }
            });
            const s1 = 'INSERT INTO appointment (app_date,app_time,pat_id,doct_id,email,meet_link) values (?,?,?,?,?,?)'
            db.query(s1, [app_date, app_time, patient_id, doc_id.split(',')[0], email,link], (err, result) => {
                if (err) throw err;
            })
            res.redirect('/');
        }
        summ();
    }
});

//Fetching and displaying all the doctors present in the database
app.get('/docs', (req, res) => {
    const sql = 'select name,age,spec,qualifications from doctor';
    db.query(sql, (err, result) => {
        if (err) throw err;
        res.render('docs', { doc: result });
    })
})

//Rendering appointment page after clicking book appointment on respective doctor
app.get('/appts/:dname', (req, res) => {
    const s = `select doc_id from doctor where name="${req.params.dname}";`
    db.query(s, (err, result) => {
        if (err) throw err;
        res.render('appointment', { result: result[0], name: req.params.dname });
    })
})

//Feedback page
app.get('/feed', (req, res) => {
    res.render('feed');
});

//Posting feedback
app.post('/feed', (req, res) => {
    const { pid, liked, imp, r, r1 } = req.body;
    const sql = 'insert into feedback (pat_id,liked,improvements,rate1,rate2)  values(?,?,?,?,?)';
    db.query(sql, [pid, liked, imp, r, r1], (err, result) => {
        if (err) throw err;
        res.redirect('/feed');
    })
})

//Generative ai (Gemini-AI) inclusion for document summarization
async function run(text) {
    console.log("in run");
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `Now You are a doctor assistant ai model , your job is to view this image and tell what patient is suffering from , and give an detailed analysis in not less than 100 words for the doctor , so that he could daignose the patient ${text}`;
    const res = await model.generateContent(prompt);
    const resp = await res.response;
    const txt = resp.text();
    return txt;
}
async function runImg(r) {
    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    const prompt = "Now You are a doctor assistant ai model , your job is to view this image and tell what patient is suffering from , and give an detailed analysis in not less than 50 words for the doctor , so that he could daignose the patient";

    const imageParts = [
        fileToGenPart(`${__dirname}\\uploads\\${r}`, "image/png"),
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const text = response.text();
    return text;
}

//User Authentication
function ensureAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.redirect('/');
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
