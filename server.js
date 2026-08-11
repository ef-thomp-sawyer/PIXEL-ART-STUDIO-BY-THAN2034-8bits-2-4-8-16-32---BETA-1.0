// ============================================
// SERVIDOR COMPLETO CON NVIDIA + POLLINATIONS
// ============================================

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();
const path = require('path');

// ============================================
// CONFIGURACIÓN
// ============================================

const app = express();
const PORT = process.env.PORT || 2493;

// Configuración de NVIDIA
const NVIDIA_CONFIG = {
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL || 'thinkingmachines/inkling'
};

// Configuración de Pollinations
const POLLINATIONS_CONFIG = {
    baseUrl: process.env.POLLINATIONS_BASE_URL || 'https://image.pollinations.ai',
    apiKey: process.env.POLLINATIONS_API_KEY || '',
    defaultModel: 'flux'
};

// Verificar API key de NVIDIA
if (!NVIDIA_CONFIG.apiKey) {
    console.error('❌ ERROR: NVIDIA_API_KEY no está definida');
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// RUTAS
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        port: PORT,
        model: NVIDIA_CONFIG.model,
        nvidiaConfigured: !!NVIDIA_CONFIG.apiKey,
        pollinationsConfigured: !!POLLINATIONS_CONFIG.apiKey,
        uptime: process.uptime()
    });
});

// ============================================================
// RUTA: Generación de imágenes con Pollinations (CON Y SIN API KEY)
// ============================================================

app.post('/api/generate-image', async (req, res) => {
    const { prompt, model = 'flux', width = 768, height = 768 } = req.body;

    // Validar prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
        return res.status(400).json({ 
            error: 'Se requiere un prompt válido (mínimo 3 caracteres)' 
        });
    }

    try {
        console.log(`🖼️ Generando imagen: "${prompt.substring(0, 50)}..."`);
        
        // Codificar el prompt
        const encodedPrompt = encodeURIComponent(prompt);
        
        // Construir URL - SIEMPRE USAR image.pollinations.ai (funciona con y sin API Key)
        let imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
        
        // Parámetros base
        const params = new URLSearchParams();
        params.append('model', model);
        params.append('width', width);
        params.append('height', height);
        params.append('nologo', 'true');
        
        // Si hay API Key, agregarla
        if (POLLINATIONS_CONFIG.apiKey) {
            params.append('key', POLLINATIONS_CONFIG.apiKey);
            console.log('🔑 Usando API Key de Pollinations');
        } else {
            console.log('🌐 Usando modo gratuito de Pollinations');
        }
        
        imageUrl += `?${params.toString()}`;

        console.log(`✅ URL generada: ${imageUrl.substring(0, 150)}...`);
        
        // Devolver la URL para que el frontend la cargue
        res.json({
            success: true,
            imageUrl: imageUrl,
            prompt: prompt,
            model: model,
            width: width,
            height: height,
            message: '✅ Imagen generada correctamente'
        });

    } catch (error) {
        console.error('❌ Error generando imagen:', error);
        res.status(500).json({
            error: 'Error al generar la imagen',
            details: error.message
        });
    }
});

// ============================================================
// RUTA: Generar Pixel Art (NUEVA - usa NVIDIA + Pollinations)
// ============================================================

app.post('/api/generate-pixelart', async (req, res) => {
    try {
        const { prompt, imageBase64, imageMimeType, height, width, palette, mode } = req.body;

        // Validaciones
        if (!prompt || prompt.trim().length < 3) {
            return res.status(400).json({ error: 'Se requiere un prompt válido' });
        }

        if (!palette || !Array.isArray(palette) || palette.length !== 4) {
            return res.status(400).json({ error: 'Se requieren exactamente 4 colores' });
        }

        if (!height || !width || height < 1 || width < 1) {
            return res.status(400).json({ error: 'Se requieren medidas válidas' });
        }

        // 1. Analizar con NVIDIA (si tiene API Key)
        let analysis = prompt;
        if (NVIDIA_CONFIG.apiKey) {
            try {
                const modeDescriptions = {
                    sprite: 'un SOLO personaje u objeto (sprite)',
                    fondo: 'un escenario o nivel completo (fondo)',
                    maqueta: 'una hoja con MÚLTIPLES sprites juntos (maqueta)'
                };

                const nvidiaPrompt = `
Eres un experto analista de imágenes y pixel art NES de 8 bits.

El usuario quiere dibujar ${modeDescriptions[mode] || 'un sprite'} de ${height}x${width} píxeles.
La paleta de colores NES es: ${palette.join(', ')}.

DESCRIPCIÓN DEL USUARIO: "${prompt}"

${imageBase64 ? 'El usuario ha subido una imagen modelo. ANALÍZALA DETALLADAMENTE:' : ''}

TAREA:
1. Describe qué se ve en la imagen (si hay imagen) o qué debería dibujarse según el prompt.
2. Identifica: forma, pose, estructura, colores aproximados, detalles importantes.
3. Da recomendaciones para convertirlo a pixel art NES de ${height}x${width} píxeles con 4 colores.
4. Sugiere cómo distribuir los 4 colores (fondo, sombras, luces, detalles).

RESPONDE CON UNA DESCRIPCIÓN CLARA Y DETALLADA.
`;

                const payload = {
                    model: NVIDIA_CONFIG.model,
                    messages: [
                        { role: 'system', content: 'Eres un experto en pixel art NES de 8 bits.' },
                        { role: 'user', content: nvidiaPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 2000
                };

                const response = await fetch(`${NVIDIA_CONFIG.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${NVIDIA_CONFIG.apiKey}`
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const data = await response.json();
                    analysis = data.choices?.[0]?.message?.content || prompt;
                    console.log('✅ NVIDIA análisis completado');
                }
            } catch (error) {
                console.warn('⚠️ Error en NVIDIA:', error.message);
            }
        }

        // 2. Generar con Pollinations
        const modeDescriptions = {
            sprite: 'sprite de personaje NES 8-bit',
            fondo: 'fondo de escenario NES 8-bit',
            maqueta: 'hoja de sprites NES 8-bit'
        };

        const pixelArtPrompt = `
Pixel art NES 8-bit, ${modeDescriptions[mode] || 'sprite'}.
Tamaño: ${width}x${height} píxeles.
Paleta de 4 colores NES: ${palette.join(', ')}.
${analysis.substring(0, 500)}

REGLAS:
- Usa EXACTAMENTE estos 4 colores: ${palette.join(', ')}
- El primer color (${palette[0]}) es el FONDO
- Estilo NES 8-bit, pixel art clásico
`;

        // Generar imagen con Pollinations
        const encodedPrompt = encodeURIComponent(pixelArtPrompt);
        let imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
        
        const params = new URLSearchParams();
        params.append('model', 'flux');
        params.append('width', width);
        params.append('height', height);
        params.append('nologo', 'true');
        
        if (POLLINATIONS_CONFIG.apiKey) {
            params.append('key', POLLINATIONS_CONFIG.apiKey);
        }
        
        imageUrl += `?${params.toString()}`;

        console.log(`🖼️ URL generada: ${imageUrl.substring(0, 150)}...`);

        // Descargar la imagen
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Error al generar imagen: ${imageResponse.status}`);
        }

        const imageBuffer = await imageResponse.buffer();
        const imageBase64Result = imageBuffer.toString('base64');

        res.json({
            success: true,
            imageBase64: imageBase64Result,
            mimeType: 'image/png',
            width: width,
            height: height,
            palette: palette,
            mode: mode || 'sprite',
            analysis: analysis,
            message: '✅ Pixel art generado correctamente'
        });

    } catch (error) {
        console.error('❌ Error en /api/generate-pixelart:', error);
        res.status(500).json({
            error: 'Error al generar pixel art',
            details: error.message
        });
    }
});

// ============================================================
// RUTA: Chat con NVIDIA
// ============================================================

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({
            error: 'Mensaje inválido. Se requiere un array de mensajes.'
        });
    }

    if (!NVIDIA_CONFIG.apiKey) {
        return res.status(500).json({
            error: 'API Key de NVIDIA no configurada.'
        });
    }

    try {
        const requestBody = {
            model: NVIDIA_CONFIG.model,
            messages: [
                {
                    role: 'system',
                    content: `Eres un asistente de IA útil y amigable. 
                    Responde en español de manera clara y concisa.`
                },
                ...messages
            ],
            temperature: 0.7,
            max_tokens: 1000,
            top_p: 0.9
        };

        const response = await fetch(`${NVIDIA_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${NVIDIA_CONFIG.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        const responseText = await response.text();

        if (!response.ok) {
            console.error('❌ Error de NVIDIA:', response.status, responseText);
            let errorMessage = 'Error al comunicarse con NVIDIA API';
            try {
                const errorData = JSON.parse(responseText);
                if (errorData.error && errorData.error.message) {
                    errorMessage = errorData.error.message;
                }
            } catch (e) {
                errorMessage = responseText || errorMessage;
            }
            return res.status(response.status).json({
                error: errorMessage,
                status: response.status
            });
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Error parseando respuesta:', e);
            return res.status(500).json({
                error: 'Respuesta inválida de NVIDIA API'
            });
        }

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('❌ Respuesta inesperada:', data);
            return res.status(500).json({
                error: 'Formato de respuesta inesperado'
            });
        }

        res.json({
            success: true,
            message: data.choices[0].message.content,
            usage: data.usage || null,
            model: data.model || NVIDIA_CONFIG.model
        });

    } catch (error) {
        console.error('❌ Error en el servidor:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Ruta 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.url
    });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🎮 PIXELART NES STUDIO');
    console.log('='.repeat(60));
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔗 URL: http://node1.lunes.host:${PORT}`);
    console.log(`🤖 NVIDIA: ${NVIDIA_CONFIG.apiKey ? '✅ Configurada' : '❌ NO CONFIGURADA'}`);
    console.log(`🔑 Pollinations: ${POLLINATIONS_CONFIG.apiKey ? '✅ Configurada' : '❌ NO CONFIGURADA (gratuito)'}`);
    console.log('='.repeat(60));
    console.log('📋 RUTAS DISPONIBLES:');
    console.log(`   🌐 Principal: http://node1.lunes.host:${PORT}/`);
    console.log(`   💚 Health: http://node1.lunes.host:${PORT}/api/health`);
    console.log(`   🖼️ Generar imagen: http://node1.lunes.host:${PORT}/api/generate-image (POST)`);
    console.log(`   🎨 Pixel Art: http://node1.lunes.host:${PORT}/api/generate-pixelart (POST)`);
    console.log(`   💬 Chat: http://node1.lunes.host:${PORT}/api/chat (POST)`);
    console.log('='.repeat(60));
});

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});