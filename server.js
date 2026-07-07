const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https'); // Встроенный модуль Node.js, npm install не нужен

const app = express();
const PORT = process.env.PORT || 3000; 

// Замени эту ссылку НА СВОЮ, которую тебе выдаст Render/хостинг после деплоя!
const SERVER_URL = 'https://твой-проект.onrender.com/list';

app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/files', express.static(path.join(__dirname, 'public/files')));

function getSavesList() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'saves_data.json'), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// 1. Получение списка сейвов
app.get('/list', (req, res) => {
    res.json(getSavesList());
});

// 2. Скачивание сейва и обновление счётчика
app.get('/download/:id', (req, res) => {
    const saveId = req.params.id;
    let list = getSavesList();
    const saveIndex = list.findIndex(s => s.id === saveId);

    if (saveIndex === -1) return res.status(404).send('Save not found');

    list[saveIndex].downloads += 1;
    
    try {
        fs.writeFileSync(path.join(__dirname, 'saves_data.json'), JSON.stringify(list, null, 2), 'utf8');
    } catch (e) { 
        console.error("Ошибка записи счетчика:", e); 
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/files/${saveId}.pc`;
    res.setHeader('Content-Type', 'text/plain');
    res.send(fileUrl);
});

// ==========================================
// ФУНКЦИЯ САМОПИНГА («БУДИЛЬНИК»)
// ==========================================
setInterval(() => {
    // Проверяем, что ссылка изменена и это не дефолтный шаблон
    if (SERVER_URL.includes('твой-проект.onrender.com')) {
        console.warn('[Будильник] Настройка не завершена! Замени SERVER_URL на реальный адрес деплоя.');
        return;
    }

    https.get(SERVER_URL, (res) => {
        console.log(`[Будильник] Сервер успешно пнул сам себя. Статус: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('[Будильник] Ошибка самопинга:', err.message);
    });
}, 600000); // 600 000 мс = 10 минут (Render засыпает через 15 минут)
// ==========================================

app.listen(PORT, () => {
    console.log(`[Воркшоп] Сервер успешно запущен на порту ${PORT}`);
});