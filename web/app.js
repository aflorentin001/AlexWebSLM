// app.js — WebLLM primary runtime with WebGPU, WASM fallback via wllama
// Enhanced UX with processing feedback and stop button

// CDN ESM endpoints (using jsdelivr for better reliability)
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.46/+esm";
const WLLAMA_URL = "https://cdn.jsdelivr.net/npm/@wllama/wllama@2.0.0/esm/wasm-from-cdn.js";

// Global state
let engine = null;
let runtime = "detecting";
let messages = [{ role: "system", content: "You are a concise, helpful assistant that runs 100% locally in the user's browser. You can analyze text files, code, and other documents that users upload as attachments." }];
let currentModel = null;
let uploadedFiles = new Map();
let currentAbortController = null;
let isProcessing = false;

// Chat history management
let chatHistory = [];
let currentChatId = null;
let isLoadingChat = false;

// DOM elements (will be set after DOM loads)
let els = {};

// Initialize the application
async function initApp() {
    console.log('🚀 Initializing YedderGirl GPT...');

    try {
        // Get all DOM elements
        els = {
            messages: document.getElementById("messages"),
            prompt: document.getElementById("prompt"),
            send: document.getElementById("send"),
            stop: document.getElementById("stop"),
            form: document.getElementById("chat-form"),
            initLabel: document.getElementById("init-label"),
            runtimeBadge: document.getElementById("runtime-badge"),
            settingsDlg: document.getElementById("settings"),
            settingsBtn: document.getElementById("btn-settings"),
            closeSettingsBtn: document.getElementById("btn-close-settings"),
            modelSelect: document.getElementById("model-select"),
            reloadModelBtn: document.getElementById("btn-reload-model"),
            clearBtn: document.getElementById("btn-clear"),
            fileUploadArea: document.getElementById("file-upload-area"),
            fileInput: document.getElementById("file-input"),
            clearFilesBtn: document.getElementById("clear-files-btn"),
            uploadedFiles: document.getElementById("uploaded-files"),
            newChatBtn: document.getElementById("new-chat-btn"),
            recentChats: document.getElementById("recent-chats"),
            clearAllChatsBtn: document.getElementById("clear-all-chats"),
        };

        // Check if all elements exist
        const missingElements = Object.entries(els).filter(([key, el]) => !el);
        if (missingElements.length > 0) {
            console.error('❌ Missing DOM elements:', missingElements.map(([key]) => key));
            return;
        }

        console.log('✅ DOM elements initialized');

        // Set up event listeners
        setupEventListeners();

        // Load chat history first
        setTimeout(() => loadChatHistory(), 100);

        // Initialize the LLM engine properly
        console.log('🔧 Initializing LLM engine...');
        
        // Show memory usage info
        if (performance.memory) {
            const memMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
            console.log(`💾 Current memory usage: ${memMB}MB`);
        }
        
        // Add timeout warning after 30 seconds
        const timeoutWarning = setTimeout(() => {
            if (runtime === "detecting") {
                addMessage("assistant", "⏳ AI model is still loading... This can take 2-5 minutes on first run as it downloads ~1-2GB. Please be patient!");
            }
        }, 30000);
        
        init().then(() => {
            clearTimeout(timeoutWarning);
            console.log('🎉 App initialization complete!');
            
            // Show final memory usage
            if (performance.memory) {
                const memMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
                console.log(`💾 Memory usage after model load: ${memMB}MB`);
            }
            
            addMessage("assistant", "✅ AI model loaded!");
        }).catch(error => {
            clearTimeout(timeoutWarning);
            console.error('❌ Initialization failed:', error);
            // Only fall back to demo if AI completely fails
            runtime = "demo";
            setBadge("Demo Mode");
            els.initLabel.textContent = "Demo mode - AI model failed to load";
            addMessage("assistant", `❌ AI model failed to load: ${error.message}\n\nYou can still use demo mode by typing questions!`);
        });

        setProcessingState(false);

    } catch (error) {
        console.error('❌ Initialization failed:', error);
        addMessage("assistant", `❌ Initialization failed: ${error.message}\n\nYou can still use demo mode by typing questions!`);
        setProcessingState(false);
    }
}

// Set up all event listeners
function setupEventListeners() {
    // Form submission
    els.form.addEventListener("submit", handleFormSubmit);

    // Stop button
    els.stop.addEventListener("click", handleStopClick);

    // File upload
    els.fileInput.addEventListener("change", handleFileUpload);

    // Clear files
    els.clearFilesBtn.addEventListener("click", handleClearFiles);

    // Settings
    els.settingsBtn.addEventListener("click", () => els.settingsDlg.showModal());
    els.closeSettingsBtn?.addEventListener("click", () => els.settingsDlg.close());

    // Model reload
    els.reloadModelBtn.addEventListener("click", handleModelReload);

    // Clear chat
    els.clearBtn.addEventListener("click", handleClearChat);

    // New chat
    els.newChatBtn.addEventListener("click", handleNewChat);

    // Clear all chats
    els.clearAllChatsBtn.addEventListener("click", handleClearAllChats);

    console.log('📋 Event listeners set up');
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    if (isProcessing) {
        console.log('⚠️ Cannot send: already processing');
        return;
    }

    const prompt = els.prompt.value.trim();
    if (!prompt) {
        console.log('⚠️ Cannot send: empty prompt');
        return;
    }

    console.log('📤 Sending message:', prompt);

    // Clear input and add user message
    els.prompt.value = "";
    addMessage("user", prompt);

    // Add file attachments to the message if any
    const fileContent = getFileAttachments();
    const fullPrompt = fileContent ? prompt + "\n\n" + fileContent : prompt;

    // Add to messages array and process (original behavior)
    messages.push({ role: "user", content: fullPrompt });

    // Process the message
    try {
        if (runtime === "demo") {
            console.log('📝 Processing in demo mode:', fullPrompt);
            await handleDemoResponse(fullPrompt);
        } else {
            console.log('🤖 Processing with AI engine:', fullPrompt);
            await handleSend(fullPrompt);
        }
    } catch (error) {
        console.error('❌ Error processing message:', error);
        addMessage("assistant", "❌ Sorry, there was an error processing your message. Please try again.");
        setProcessingState(false);
    }
}

// Handle stop button click
function handleStopClick() {
    if (currentAbortController) {
        console.log('🛑 Stopping current request...');
        currentAbortController.abort();
        currentAbortController = null;

        // Find and update the processing message
        const processingMsg = els.messages.querySelector('.processing');
        if (processingMsg) {
            processingMsg.textContent = "⏹️ Request cancelled by user";
            processingMsg.classList.remove('processing');
        }
    }
    setProcessingState(false);
}

// Handle file upload
function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    console.log(`📁 Processing ${files.length} file(s)...`);

    // Clear previous files
    els.uploadedFiles.innerHTML = '';

    files.forEach(async (file) => {
        try {
            const content = await readFileContent(file);
            const fileId = Date.now() + Math.random().toString(36).substr(2, 9);

            uploadedFiles.set(fileId, {
                file: file,
                content: content,
                name: file.name,
                size: file.size,
                type: file.type
            });

            displayUploadedFile(file, fileId);
        } catch (error) {
            console.error('Error processing file:', error);
            addMessage("assistant", `❌ Error reading file ${file.name}: ${error.message}`);
        }
    });

    e.target.value = ''; // Reset input
}

// Handle clear files
function handleClearFiles() {
    uploadedFiles.clear();
    els.uploadedFiles.innerHTML = '';
    console.log('🗑️ All files cleared');
}

// Handle model reload
async function handleModelReload(e) {
    e.preventDefault();
    currentModel = els.modelSelect.value;
    await reloadModel();
}

// Clear chat function is now handled by chat history system


// Set processing state (affects UI)
function setProcessingState(processing) {
    isProcessing = processing;

    if (processing) {
        els.send.style.display = 'none';
        els.stop.style.display = 'inline-block';
        els.prompt.disabled = true;
        els.prompt.placeholder = "Processing...";
    } else {
        els.send.style.display = 'inline-block';
        els.stop.style.display = 'none';
        els.prompt.disabled = false;
        els.prompt.placeholder = "Ask anything (runs locally)...";
        els.prompt.focus();
    }
}

// Add message to chat
function addMessage(who, text) {
    const row = document.createElement("div");
    row.className = "msg " + (who === "assistant" ? "assistant" : "user");

    const whoEl = document.createElement("div");
    whoEl.className = "who";
    whoEl.textContent = who;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    row.append(whoEl, bubble);
    els.messages.append(row);
    els.messages.scrollTop = els.messages.scrollHeight;

    // Add to messages array (keep original behavior)
    if (who !== 'system') {
        messages.push({ role: who, content: text });
    }
    
    // Save to chat history (non-blocking)
    if (currentChatId && who !== 'system' && !isLoadingChat) {
        try {
            const currentChat = chatHistory.find(c => c.id === currentChatId);
            if (currentChat) {
                currentChat.messages = [...messages];
                clearTimeout(window.chatSaveTimeout);
                window.chatSaveTimeout = setTimeout(() => {
                    try {
                        saveChatHistory();
                    } catch (e) {
                        console.warn('Failed to save chat history:', e);
                    }
                }, 1000);
            }
        } catch (e) {
            console.warn('Chat history error:', e);
        }
    }

    return bubble;
}

// Display uploaded file
function displayUploadedFile(file, fileId) {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.dataset.fileId = fileId;

    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.textContent = file.name;
    fileName.title = file.name;

    const fileSize = document.createElement('div');
    fileSize.className = 'file-size';
    fileSize.textContent = formatFileSize(file.size);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-file';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove file';
    removeBtn.onclick = () => removeUploadedFile(fileId);

    fileItem.appendChild(fileName);
    fileItem.appendChild(fileSize);
    fileItem.appendChild(removeBtn);
    els.uploadedFiles.appendChild(fileItem);
}

// Remove uploaded file
function removeUploadedFile(fileId) {
    uploadedFiles.delete(fileId);
    const fileItem = document.querySelector(`[data-file-id="${fileId}"]`);
    if (fileItem) {
        fileItem.remove();
    }
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Read file content
function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            let content = e.target.result;
            if (file.type && !file.type.startsWith('text/')) {
                content = `[Binary file: ${file.name} (${file.type || 'unknown type'}) - ${formatFileSize(file.size)}]`;
            }
            resolve(content);
        };

        reader.onerror = () => reject(new Error('Failed to read file'));

        if (file.type && file.type.startsWith('text/')) {
            reader.readAsText(file);
        } else {
            reader.readAsDataURL(file);
        }
    });
}

// Clear all files
function clearAllFiles() {
    uploadedFiles.clear();
    els.uploadedFiles.innerHTML = '';
}

// Stop current request
function stopCurrentRequest() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
    setProcessingState(false);
}

// Get uploaded files content
function getUploadedFilesContent() {
    let content = '';
    if (uploadedFiles.size > 0) {
        content += '\n\n--- ATTACHED FILES ---\n';
        for (const [fileId, fileData] of uploadedFiles) {
            content += `\nFile: ${fileData.name}\n`;
            content += `Size: ${formatFileSize(fileData.size)}\n`;
            content += `Type: ${fileData.type || 'unknown'}\n\n`;
            content += fileData.content;
            content += '\n---\n';
        }
    }
    return content;
}

// Initialize WebLLM or fallback to WASM
async function init() {
    console.log('🔧 Starting runtime detection...');
    setBadge("Detecting runtime…");
    els.initLabel.textContent = "Initializing AI model...";
    
    try {
        return await initWithTimeout();
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        throw error;
    }
}

async function initWithTimeout() {
    // Try WebGPU first
    if (typeof navigator !== "undefined" && navigator.gpu) {
        try {
            console.log('🎮 Attempting WebGPU initialization...');
            setBadge("Loading WebLLM library...");
            els.initLabel.textContent = "Loading AI library...";
            
            let webllm;
            try {
                const module = await import(WEBLLM_URL);
                webllm = module.default || module;
                console.log('✅ WebLLM library loaded successfully');
            } catch (importError) {
                console.error('❌ Failed to import WebLLM:', importError);
                throw new Error(`Failed to load WebLLM library: ${importError.message}`);
            }
            
            // Check if WebGPU is actually available
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                throw new Error("WebGPU adapter not available");
            }

            // Force use of the smallest available model
            currentModel = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"; // Only ~300MB
            
            // Populate model dropdown but force small model
            try {
                const list = webllm.prebuiltAppConfig?.model_list || [];
                if (Array.isArray(list) && list.length) {
                    els.modelSelect.innerHTML = "";
                    
                    // Find the smallest models first
                    const smallModels = [
                        "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",  // ~300MB
                        "Llama-3.2-1B-Instruct-q4f32_1-MLC", // ~600MB
                        "Phi-3.5-mini-instruct-q4f16_1-MLC"  // ~800MB
                    ];
                    
                    const availableSmallModels = list.filter(m => smallModels.includes(m.model_id));
                    const otherModels = list.filter(m => !smallModels.includes(m.model_id));
                    
                    [...availableSmallModels, ...otherModels].forEach(m => {
                        const opt = document.createElement("option");
                        opt.value = m.model_id;
                        const size = smallModels.includes(m.model_id) ? " (Small)" : " (Large)";
                        opt.textContent = m.model_id + size;
                        els.modelSelect.appendChild(opt);
                    });
                    
                    // Force the smallest model
                    if (availableSmallModels.length > 0) {
                        currentModel = availableSmallModels[0].model_id;
                    }
                    els.modelSelect.value = currentModel;
                }
            } catch (e) {
                console.warn("Could not populate model list:", e);
                currentModel = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
            }
            
            console.log(`🎯 Forcing small model: ${currentModel}`);

            setBadge("WebGPU (WebLLM) — initializing…");
            els.initLabel.textContent = "Loading model (first run downloads weights)…";

            const engineConfig = {
                initProgressCallback: (r) => {
                    const progress = r.progress ? ` (${Math.round(r.progress * 100)}%)` : '';
                    const progressText = r.text || "Loading…";
                    
                    // Show more detailed progress
                    if (progressText.includes("download")) {
                        els.initLabel.textContent = `Downloading model${progress} - This may take a few minutes on first run`;
                        setBadge(`Downloading${progress}`);
                    } else if (progressText.includes("load")) {
                        els.initLabel.textContent = `Loading model into memory${progress}`;
                        setBadge(`Loading${progress}`);
                    } else {
                        els.initLabel.textContent = progressText + progress;
                    }
                    
                    console.log('📥 Model loading:', progressText, progress);
                },
                appConfig: webllm.prebuiltAppConfig,
            };

            engine = await webllm.CreateMLCEngine(currentModel, engineConfig);
            runtime = "webgpu";
            setBadge("WebGPU (WebLLM)");
            els.initLabel.textContent = "Ready.";
            return;
        } catch (err) {
            console.warn("WebGPU path failed, falling back to WASM:", err);
        }
    }

    // Fallback to WASM
    runtime = "wasm";
    setBadge("WASM (wllama) — initializing…");
    els.initLabel.textContent = "Loading tiny GGUF (first run downloads)…";

    const { default: WasmFromCDN } = await import(WLLAMA_URL);
    const assets = (typeof WasmFromCDN === "function") ? WasmFromCDN() : WasmFromCDN;

    const { startWasmFallback } = await import("./fallback/wllama.js");
    engine = await startWasmFallback({ WasmFromCDN: assets });

    setBadge("WASM (wllama)");
    els.initLabel.textContent = "Ready (fallback).";
}

// Reload model
async function reloadModel() {
    if (runtime !== "webgpu") return alert("Model reload only applies to WebLLM path.");
    els.initLabel.textContent = "Reloading model…";
    const webllm = await import(WEBLLM_URL);
    const cfg = { initProgressCallback: (r) => (els.initLabel.textContent = r.text || "Loading…") };
    engine = await webllm.CreateMLCEngine(currentModel, cfg);
    els.initLabel.textContent = "Ready.";
}

// Set runtime badge
function setBadge(txt, ok = true) {
    els.runtimeBadge.textContent = txt;
    els.runtimeBadge.style.background = ok ? "#dcfce7" : "#fee2e2";
    els.runtimeBadge.style.border = "1px solid " + (ok ? "#bbf7d0" : "#fecaca");
    els.runtimeBadge.style.color = ok ? "#14532d" : "#7f1d1d";
}

// Handle send message
async function handleSend(prompt) {
    // Check if engine is ready
    if (!engine) {
        console.log('⚠️ Engine not ready, using demo mode');
        await handleDemoResponse(prompt);
        return;
    }

    const filesContent = getUploadedFilesContent();
    const fullPrompt = prompt + filesContent;

    console.log(`🔧 Processing with ${runtime} runtime`);
    console.log(`📄 Files attached: ${uploadedFiles.size}`);

    // Set up AbortController for cancellation
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
        if (runtime === "webgpu") {
            const webllm = await import(WEBLLM_URL);
            
            // Add processing message
            const processingBubble = addMessage("assistant", "🧠 Processing your question with WebLLM...");
            processingBubble.classList.add('processing');

            const chunks = await engine.chat.completions.create({
                messages,
                stream: true,
                stream_options: { include_usage: true },
                temperature: Number(document.getElementById("temperature").value || 0.7),
                seed: Number(document.getElementById("seed").value || 0),
                signal: signal,
            });

            // Remove processing indicator and start streaming
            processingBubble.classList.remove('processing');

            let acc = "";
            for await (const ch of chunks) {
                if (signal.aborted) {
                    console.log('🛑 Request aborted during streaming');
                    return;
                }
                const delta = ch.choices?.[0]?.delta?.content || "";
                acc += delta;

                // Update the message in real-time
                processingBubble.textContent = acc;
            }
            
            // Add final response to messages array
            messages.push({ role: "assistant", content: acc });
            console.log('✅ WebGPU response completed');

        } else {
            // WASM fallback
            const processingMsg = els.messages.querySelector('.processing');
            if (processingMsg) {
                processingMsg.textContent = "🧠 Processing your question with WASM...";
            }

            const out = await engine.complete(fullPrompt, { nPredict: 128, temp: 0.7 });
            if (signal.aborted) {
                console.log('🛑 WASM request aborted');
                return;
            }

            // Remove processing indicator
            if (processingMsg) {
                processingMsg.classList.remove('processing');
                processingMsg.textContent = out || "(no output)";
            }

            messages.push({ role: "assistant", content: out || "" });
            console.log('✅ WASM response completed');
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('🛑 Request cancelled by user');
            return;
        } else {
            console.error('❌ Processing error:', e);
            // Fall back to demo mode on error
            console.log('🔄 Falling back to demo mode due to error');
            await handleDemoResponse(prompt);
        }
    } finally {
        currentAbortController = null;
    }
}

// Demo response when LLM engine isn't available
async function handleDemoResponse(prompt) {
    console.log('🎭 Starting demo response for:', prompt);
    setProcessingState(true);
    
    // Add processing message
    const processingBubble = addMessage("assistant", "🤖 Processing your question...");
    processingBubble.classList.add('processing');

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    const responses = [
        `Hello! I received your message: "${prompt}". I'm currently running in demo mode while the AI model loads in the background. In a full deployment, I would provide intelligent responses to your questions.`,
        `Thanks for asking "${prompt}"! I'm a local AI assistant that runs entirely in your browser. Right now I'm in demo mode, but normally I'd analyze your question and provide helpful, contextual responses.`,
        `I see you asked: "${prompt}". I'm YedderGirl GPT, a small language model designed to run locally. While the full AI model loads, I can acknowledge your messages and demonstrate the chat interface.`,
        `Your question "${prompt}" has been received! I'm designed to be a helpful AI assistant that processes everything locally in your browser for privacy. The full model is initializing in the background.`,
        `Hi there! You asked "${prompt}". I'm running in demonstration mode right now. Once fully loaded, I can help with questions, analyze documents, and provide intelligent responses - all while keeping your data private and local.`
    ];

    const response = responses[Math.floor(Math.random() * responses.length)];

    // Update the processing message
    processingBubble.classList.remove('processing');
    processingBubble.textContent = response;
    
    setProcessingState(false);
    console.log('✅ Demo response completed for:', prompt);
}

// Chat History Management
function generateChatId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function createNewChat() {
    const chatId = generateChatId();
    const chat = {
        id: chatId,
        title: "New Chat",
        messages: [{ role: "system", content: "You are a concise, helpful assistant that runs 100% locally in the user's browser. You can analyze text files, code, and other documents that users upload as attachments." }],
        timestamp: Date.now()
    };
    
    chatHistory.unshift(chat);
    currentChatId = chatId;
    
    // Limit to 50 chats
    if (chatHistory.length > 50) {
        chatHistory = chatHistory.slice(0, 50);
    }
    
    saveChatHistory();
    return chat;
}

function saveChatHistory() {
    try {
        localStorage.setItem('yeddergirl-chat-history', JSON.stringify(chatHistory));
        localStorage.setItem('yeddergirl-current-chat', currentChatId);
    } catch (e) {
        console.warn('Could not save chat history:', e);
    }
}

function loadChatHistory() {
    console.log('📚 Loading chat history...');
    try {
        // Create a new chat for this session
        const chatId = generateChatId();
        currentChatId = chatId;
        
        // Try to load existing history
        const saved = localStorage.getItem('yeddergirl-chat-history');
        if (saved) {
            chatHistory = JSON.parse(saved);
            console.log(`📚 Loaded ${chatHistory.length} previous chats`);
        } else {
            chatHistory = [];
        }
        
        // Add current chat to history
        const chat = {
            id: chatId,
            title: "New Chat",
            messages: [...messages],
            timestamp: Date.now()
        };
        
        chatHistory.unshift(chat);
        
        // Limit to 20 chats for performance
        if (chatHistory.length > 20) {
            chatHistory = chatHistory.slice(0, 20);
        }
        
        saveChatHistory();
        renderChatHistory();
        console.log('✅ Chat history loaded successfully');
    } catch (e) {
        console.warn('⚠️ Could not load chat history:', e);
        // Minimal fallback
        currentChatId = Date.now().toString();
        chatHistory = [];
    }
}

function loadChat(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (!chat) return;
    
    isLoadingChat = true;
    currentChatId = chatId;
    messages = [...chat.messages];
    
    // Clear and reload messages
    els.messages.innerHTML = "";
    
    // Display non-system messages
    messages.filter(m => m.role !== 'system').forEach(msg => {
        addMessage(msg.role, msg.content);
    });
    
    isLoadingChat = false;
    
    // Update active state in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.toggle('active', item.dataset.chatId === chatId);
    });
    
    saveChatHistory();
}

function updateChatTitle(chatId, newTitle) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
        chat.title = newTitle;
        saveChatHistory();
        renderChatHistory();
    }
}

function saveCurrentChat() {
    if (!currentChatId) return;
    
    const chat = chatHistory.find(c => c.id === currentChatId);
    if (chat) {
        // Update the chat's message array with current messages
        chat.messages = [...messages];
        chat.timestamp = Date.now();
        
        // Auto-generate title from first user message
        const firstUserMsg = messages.find(m => m.role === 'user');
        const needsNewTitle = firstUserMsg && chat.title === "New Chat";
        if (needsNewTitle) {
            const title = firstUserMsg.content.slice(0, 50).trim();
            chat.title = title.length < firstUserMsg.content.length ? title + "..." : title;
        }
        
        try {
            saveChatHistory();
            
            // Only re-render if title changed
            if (needsNewTitle) {
                renderChatHistory();
            }
        } catch (e) {
            console.warn('Could not save chat:', e);
        }
    }
}

function renderChatHistory() {
    if (!els.recentChats) return;
    
    els.recentChats.innerHTML = '';
    
    chatHistory.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        chatItem.dataset.chatId = chat.id;
        
        if (chat.id === currentChatId) {
            chatItem.classList.add('active');
        }
        
        // Chat title text
        const chatText = document.createElement('div');
        chatText.className = 'chat-item-text';
        chatText.textContent = chat.title;
        chatText.title = chat.title;
        
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'chat-delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete this chat';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteChat(chat.id);
        });
        
        // Click handler for loading chat
        chatText.addEventListener('click', () => loadChat(chat.id));
        
        chatItem.appendChild(chatText);
        chatItem.appendChild(deleteBtn);
        els.recentChats.appendChild(chatItem);
    });
}

function handleNewChat() {
    createNewChat();
    
    // Clear current messages display
    els.messages.innerHTML = "";
    clearAllFiles();
    stopCurrentRequest();
    
    renderChatHistory();
}

// Handle clear chat with chat history integration
function handleClearChat() {
    if (currentChatId) {
        // Remove current chat from history
        chatHistory = chatHistory.filter(c => c.id !== currentChatId);
    }
    
    // Create new chat
    createNewChat();
    
    // Clear display
    els.messages.innerHTML = "";
    clearAllFiles();
    stopCurrentRequest();
    
    renderChatHistory();
}

// Delete individual chat
function handleDeleteChat(chatId) {
    if (confirm('Are you sure you want to delete this chat?')) {
        // Remove from history
        chatHistory = chatHistory.filter(c => c.id !== chatId);
        
        // If deleting current chat, create a new one
        if (chatId === currentChatId) {
            createNewChat();
            els.messages.innerHTML = "";
            clearAllFiles();
            addMessage("assistant", "✅ AI model loaded!");
        }
        
        saveChatHistory();
        renderChatHistory();
        console.log('🗑️ Chat deleted:', chatId);
    }
}

// Clear all chat history
function handleClearAllChats() {
    if (confirm('Are you sure you want to delete all chat history? This cannot be undone.')) {
        chatHistory = [];
        localStorage.removeItem('yeddergirl-chat-history');
        localStorage.removeItem('yeddergirl-current-chat');
        
        // Create new chat
        createNewChat();
        els.messages.innerHTML = "";
        clearAllFiles();
        
        renderChatHistory();
        addMessage("assistant", "✅ AI model loaded!");
        console.log('🗑️ All chats cleared');
    }
}

// Chat history integration complete

// Initialize when DOM is ready
function waitForDOM() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else if (document.readyState === 'interactive' || document.readyState === 'complete') {
        // Add a small delay to ensure all elements are rendered
        setTimeout(initApp, 100);
    } else {
        initApp();
    }
}

waitForDOM();
