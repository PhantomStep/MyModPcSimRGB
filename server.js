const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000; 

// ==========================================
// НАСТРОЙКИ (ВСТАВЬ СВОЙ ТОКЕН И URL)
// ==========================================
const SERVER_URL = 'https://mymodpcsimrgb.onrender.com';
const TG_TOKEN = '8844725455:AAH1-lk3oIXTvjREjXZispMghJ6eYEaw5Ys';

const bot = new TelegramBot(TG_TOKEN, { polling: true });

// Хранилище пошаговых сессий для ВСЕХ пользователей
// Этапы: 1 - аватарка, 2 - название, 3 - описание, 4 - файл .pc
const tgSessions = {};

app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/files', express.static(path.join(__dirname, 'public/files')));

app.get('/', (req, res) => res.send('Workshop Server with Open TG Bot is Online!'));

if (!fs.existsSync('./public/files')) fs.mkdirSync('./public/files', { recursive: true });
if (!fs.existsSync('./public/images')) fs.mkdirSync('./public/images', { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, file.originalname.endsWith('.pc') ? './public/files' : './public/images');
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage: storage });

function getSavesList() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'saves_data.json'), 'utf8');
        return JSON.parse(data);
    } catch (error) { return []; }
}

function saveSavesList(list) {
    fs.writeFileSync(path.join(__dirname, 'saves_data.json'), JSON.stringify(list, null, 2), 'utf8');
}

// 1. Получение списка сейвов для Unity
app.get('/list', (req, res) => res.json(getSavesList()));

// 2. Скачивание сейва
app.get('/download/:id', (req, res) => {
    const saveId = req.params.id;
    let list = getSavesList();
    const saveIndex = list.findIndex(s => s.id === saveId);
    if (saveIndex === -1) return res.status(404).send('Save not found');

    list[saveIndex].downloads += 1;
    saveSavesList(list);

    res.setHeader('Content-Type', 'text/plain');
    res.send(`${req.protocol}://${req.get('host')}/files/${saveId}.pc`);
});

// 3. Загрузка СЕЙВА ИЗ UNITY (если решишь слать напрямую из игры)
app.post('/upload', upload.fields([{ name: 'saveFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]), (req, res) => {
    try {
        const { title, author, description } = req.body;
        const saveFile = req.files['saveFile'] ? req.files['saveFile'][0] : null;
        const imageFile = req.files['imageFile'] ? req.files['imageFile'][0] : null;

        if (!saveFile || !imageFile) return res.status(400).json({ success: false, message: 'Файлы не найдены' });

        const uniqueId = Date.now().toString();
        const ext = path.extname(imageFile.originalname) || '.png';

        fs.renameSync(saveFile.path, path.join(__dirname, 'public/files', `${uniqueId}.pc`));
        fs.renameSync(imageFile.path, path.join(__dirname, 'public/images', `${uniqueId}${ext}`));

        let list = getSavesList();
        const newSave = {
            id: uniqueId,
            title: title || "Без названия",
            author: author || "Аноним",
            description: description || "",
            downloads: 0,
            imageUrl: `${SERVER_URL}/images/${uniqueId}${ext}`
        };
        list.push(newSave);
        saveSavesList(list);

        res.json({ success: true, id: uniqueId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// ОТКРЫТАЯ ЛОГИКА ТЕЛЕГРАМ-БОТА (ДЛЯ ВСЕХ)
// ==========================================

// Отмена загрузки
bot.onText(/\/cancel/, (msg) => {
    delete tgSessions[msg.chat.id];
    bot.sendMessage(msg.chat.id, "❌ Загрузка отменена. Чтобы начать заново, введи /add");
});

// Старт пошагового процесса
bot.onText(/\/add|^\/start$/, (msg) => {
    tgSessions[msg.chat.id] = { step: 1, user: msg.from.username || msg.from.first_name || "Юзер ТГ" };
    bot.sendMessage(msg.chat.id, "🚀 Начинаем загрузку твоего сейва в общий Воркшоп!\n\n**Этап 1 из 4:** Отправь аватарку (скриншот) сборки как фото.", { parse_mode: 'Markdown' });
});

// Обработка шагов
bot.on('message', async (msg) => {
    // Игнорируем стандартные команды
    if (msg.text === '/cancel' || msg.text === '/add' || msg.text === '/start') return;

    const session = tgSessions[msg.chat.id];
    if (!session) return; // Если человек не прописал /add, бот просто молчит

    // --- ЭТАП 1: Получение аватарки ---
    if (session.step === 1) {
        if (!msg.photo) {
            return bot.sendMessage(msg.chat.id, "⚠️ Ошибка! Нужно отправить именно фото (как изображение), а не файл и не текст. Попробуй ещё раз.");
        }
        session.photoId = msg.photo[msg.photo.length - 1].file_id;
        session.step = 2;
        return bot.sendMessage(msg.chat.id, "📸 Аватарка принята!\n\n**Этап 2 из 4:** Напиши название для этого сейва.");
    }

    // --- ЭТАП 2: Получение названия ---
    if (session.step === 2) {
        if (!msg.text) {
            return bot.sendMessage(msg.chat.id, "⚠️ Ошибка! Название должно быть текстом. Напиши название.");
        }
        session.title = msg.text.trim();
        session.step = 3;
        return bot.sendMessage(msg.chat.id, `✅ Название "${session.title}" записано!\n\n**Этап 3 из 4:** Напиши описание сборки.`);
    }

    // --- ЭТАП 3: Получение описания ---
    if (session.step === 3) {
        if (!msg.text) {
            return bot.sendMessage(msg.chat.id, "⚠️ Ошибка! Описание должно быть текстом. Напиши описание.");
        }
        session.description = msg.text.trim();
        session.step = 4;
        return bot.sendMessage(msg.chat.id, "📝 Описание добавлено!\n\n**Этап 4 из 4:** Отправь файл сейва с расширением `.pc` (как документ).");
    }

    // --- ЭТАП 4: Файл .pc и публикация ---
    if (session.step === 4) {
        if (!msg.document || !msg.document.file_name.endsWith('.pc')) {
            return bot.sendMessage(msg.chat.id, "⚠️ Ошибка! Нужен только файл с расширением **.pc**. Отправь правильный файл.");
        }

        const uniqueId = Date.now().toString();
        bot.sendMessage(msg.chat.id, "⏳ Все данные собраны. Скачиваю файлы и публикую сейв в Воркшоп...");

        try {
            // Скачиваем картинку из ТГ
            const photoStream = bot.getFileStream(session.photoId);
            const imgPath = path.join(__dirname, 'public/images', `${uniqueId}.png`);
            const imgWrite = fs.createWriteStream(imgPath);
            photoStream.pipe(imgWrite);

            // Скачиваем .pc файл из ТГ
            const pcStream = bot.getFileStream(msg.document.file_id);
            const pcPath = path.join(__dirname, 'public/files', `${uniqueId}.pc`);
            const pcWrite = fs.createWriteStream(pcPath);
            pcStream.pipe(pcWrite);

            await new Promise((resolve) => imgWrite.on('finish', resolve));
            await new Promise((resolve) => pcWrite.on('finish', resolve));

            // Сохраняем в общий JSON
            let list = getSavesList();
            list.push({
                id: uniqueId,
                title: session.title,
                author: session.user, // Автоматически подтягиваем никнейм человека из Телеграма
                description: session.description,
                downloads: 0,
                imageUrl: `${SERVER_URL}/images/${uniqueId}.png`
            });
            saveSavesList(list);

            bot.sendMessage(msg.chat.id, `🎉 УРА! Твой сейв "${session.title}" успешно опубликован!\nТеперь он доступен всем в игре.`);
            
            // Удаляем сессию конкретного юзера
            delete tgSessions[msg.chat.id];

        } catch (err) {
            console.error(err);
            bot.sendMessage(msg.chat.id, "❌ Ошибка при сохранении: " + err.message);
        }
    }
});

// Самопинг
setInterval(() => {
    if (SERVER_URL.includes('твой-проект')) return;
    https.get(SERVER_URL, (res) => console.log(`[Будильник] Статус: ${res.statusCode}`)).on('error', () => {});
}, 600000);

app.listen(PORT, () => console.log(`Сервер и открытый пошаговый бот запущены на порту ${PORT}`));
