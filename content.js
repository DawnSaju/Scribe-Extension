(() => {
    const platforms = ['netflix.com', 'www.netflix.com', 'youtube.com', 'www.youtube.com'];

    window.addEventListener('message', (event) => {
    if (event.data?.source !== 'web-app') return;
    if (!event.data?.type) return;

    console.log('Got response from web app:', event.data);

    switch (event.data.type) {
        case 'EXTENSION_PING':
        window.postMessage({
            source: 'chrome-extension',
            type: 'EXTENSION_PONG'
        }, '*');
        break;
        
        case 'EXTENSION_DATA':
        console.log('[ContentScript] Got data from web app:', event.data.data);
        break;
    }
    });

    window.postMessage({
    source: 'chrome-extension',
    type: 'EXTENSION_HANDSHAKE'
    }, '*');

    
    if (!platforms.includes(window.location.hostname)) {
        return; 
    }

    function isNetflix() {
        return /^https?:\/\/(www\.)?netflix\.com\/watch\/\d+/.test(window.location.href);
    }

    function isYoutube(){
        return /^https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(window.location.href);
    }

    const savedWords = new Set();
    let wordCount = 0;
    let videoElement = null;
    let wasPlayingBefore = false;
    let watchStartTime = null;
    let timetracked = 0;
    let timeinterval = null;
    let pauseTimeoutId = null;

    function formatTime(seconds) {
        const m = String(Math.floor(seconds / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
        return `${m}:${s}`;
    }

    function startTracking(){
        if (pauseTimeoutId) {
            clearTimeout(pauseTimeoutId);
            pauseTimeoutId = null;
        }
        if (!watchStartTime) {
            watchStartTime = Date.now();
            timeinterval = setInterval(() => {
                const now = Date.now();
                timetracked = timetracked + now - watchStartTime
                watchStartTime = now;
            }, 1000);
        }
    }

    function stopTracking(){
        if (watchStartTime) {
            timetracked = timetracked + Date.now() - watchStartTime;
            watchStartTime = null;
        }

        if (timeinterval) {
            clearInterval(timeinterval);
            timeinterval = null;
        }

        const currentShowData = getVideoinfo();

        if (!pauseTimeoutId) {
            pauseTimeoutId = setTimeout(() => timeoutTime(currentShowData), 20000);
        }
    }

    const removeModal = () => {
        const modal = document.getElementById('scribe-modal');
        const overlay = document.getElementById('scribe-overlay');
        if (modal) modal.remove();
        if (overlay) overlay.remove();
        
        if (videoElement && wasPlayingBefore) {
            videoElement.play().catch(e => {
                console.log("Couldn't play video', e");
                videoElement.muted = true;
                videoElement.play();
            });
        }
    };

    function hideOverlay() {
        const source = document.querySelector('.caption-window');
        if (source) {
            source.style.opacity = '1';
        }
        removeModal();
        const elements = ['scribe-sub-wrapper', 'scribe-toast', 'scribe-counter', 'scribe-timer', 'session-modal', 'session-overlay'];
        elements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
    }

    const showToast = (text) => {
        const toast = document.getElementById('scribe-toast');
        if (!toast) return;
        toast.textContent = text;
        toast.style.opacity = 1;
        setTimeout(() => {
            toast.style.opacity = 0;
        }, 1200);
    };

    function translate(text, targetLang, sourceLang = null) {
        const word = text.replace(/=/g, '');
        const baseUrl = "https://ftapi.pythonanywhere.com/translate";
        const url = sourceLang
          ? `${baseUrl}?sl=${sourceLang}&dl=${targetLang}&text=${encodeURIComponent(word)}`
          : `${baseUrl}?dl=${targetLang}&text=${encodeURIComponent(word)}`;
      
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      
        return fetch(proxyUrl)
          .then(response => {
            if (!response.ok) {
              throw new Error(`API error: ${response.status}`);
            }
            return response.json();
          })
          .then(data => {
            console.log("Translation result:", data);
            return {
              translatedText: data["destination-text"],
              pronunciation: data.pronunciation,
              allTranslations: data.translations?.["all-translations"],
              definitions: data.definitions,
            };
          })
          .catch(error => {
            console.error("Translation API failed:", error);
            return null;
          });
      }
      

    let wordTranslations;
    let wordDefinition;

    function getVideoinfo() {
        if (isYoutube()) {
            const videoTitleEl = document.querySelector('#movie_player .ytp-title-link');
            const channelEl = document.querySelector('.ytp-chrome-top .ytp-title-channel-logo');
            const thumbnailimg = document.querySelector('#watch7-content > link:nth-child(9)').href
            // console.log(document.querySelector('#watch7-content > link:nth-child(9)'))
            // console.log(thumbnailimg)
            
            return {
                show_name: videoTitleEl ? videoTitleEl.innerText : 'YouTube Video',
                thumbnailURL: thumbnailimg,
                episode_title: null,
                season: null,
                episode: null,
                channel: channelEl ? channelEl.ariaLabel : 'Channel'
            };
        } 
        
        if (isNetflix()) {
            const container = document.querySelector('.ltr-1m81c36');
            const h4 = document.querySelector('h4');
            const showName = h4 ? h4.textContent.trim() : '';
        
            if (!container || container.offsetParent === null) {
                return { show_name: showName, season: null, episode: null, episode_title: '' };
            }
        
            const spans = Array.from(container.querySelectorAll('span'));
        
            let episodeTitle = '';
            let season = null;
            let episode = null;
        
            spans.forEach((span) => {
                const text = span.textContent.trim();
                let match = text.match(/S(\d+):E(\d+)/i);
                if (match) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                    return;
                }
                match = text.match(/E(\d+)/i);
                if (match && !episode) {
                    episode = parseInt(match[1]);
                    return;
                }
                if (!/^[SE]?\d+/i.test(text) && text.length > episodeTitle.length) {
                    episodeTitle = text;
                }
            });
        
            return {
                show_name: showName,
                season,
                episode,
                episode_title: episodeTitle
            };
        }

        return {};
    }

    const saveWord = async (word) => {
        const cleanedWord = word.replace(/[^a-zA-Z']/g, '');
        if (!cleanedWord) return;
    
        const lowerWord = cleanedWord.toLowerCase();
            
        if (!savedWords.has(lowerWord)) {
          const verify = await showModal(word, "default");
          if (!verify?.profanity) {
            console.log('Word sent to background.js:', cleanedWord);
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanedWord}`);
            const data = await response.json();
            const meaning = data[0]?.meanings?.[0];
            const partOfSpeech = meaning?.partOfSpeech || 'unknown';
            const definition = meaning?.definitions?.[0]?.definition || 'No definition found.';
            const example = meaning?.definitions?.[0]?.example || 'No example found.';
            const phonetics = meaning?.phonetics?.[0]?.text || 'No phonetics found.';
            showToast(`Saved: "${word}"`);
            wordDefinition = definition;
            savedWords.add(lowerWord);
            wordCount++;
            updateCounter();
            
            const metadata = getVideoinfo();

            translate(cleanedWord, "ar").then(result => {
                if (result) {
                console.log("Translated Text:", result.translatedText);
                wordTranslations = result.translatedText;
                showModal(word); 
                }
            });          

            const platform = isNetflix() ? 'Netflix' : isYoutube() ? 'YouTube' : 'Unknown';

            console.log("THUMBNAIL:", metadata.thumbnailURL);
            console.log("PLATFORM:", platform)

            chrome.runtime.sendMessage({
                type: 'SEND_DATA',
                data: {
                    id: Math.floor(Math.random() * 1000000).toString(),
                    word: cleanedWord,
                    part_of_speech: partOfSpeech,
                    is_new: true,
                    definition: definition,
                    phonetics: phonetics,
                    example: example,
                    platform: platform,
                    thumbnailimg: isYoutube ? metadata.thumbnailURL : '',
                    show_name: metadata.show_name,
                    season: metadata.season,
                    episode: metadata.episode,
                }
                }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending message to background:", chrome.runtime.lastError.message);
                } else {
                    console.log("Background response:", response);
                }
            });

            console.log('Saved:', cleanedWord);
          } else {
            showModal(word, "profanity");
          }
        } else {
          showToast(`Already saved: "${word}"`);
        }
    };

    const timeoutTime = (data) => {
        if (!videoElement || !videoElement.paused) {
            if (pauseTimeoutId) {
                clearTimeout(pauseTimeoutId);
            }
            return;
        }

        const info = data || getVideoinfo();

        if (isNetflix()) {
            const showName = info.show_name || 'Current Show';
            const season = info.season ? `S${info.season}` : '';
            const episode = info.episode ? `E${info.episode}` : '';
            const episodeInfo = (season || episode) ? `: ${season}${episode}` : '';

            showModal(`Session Paused ${showName}${episodeInfo}`, "session-paused");
        }

        if (isYoutube()) {
            showModal(`Session Paused`, "session-paused")
        }

        if (pauseTimeoutId) {
            clearTimeout(pauseTimeoutId);
            pauseTimeoutId = null;
        }
    }
    
    const showModal = async (messageText, type = "default") => {
        removeModal();
        
        let wasPlayingBeforeModal = videoElement && !videoElement.paused;
        if (wasPlayingBeforeModal) {
            videoElement.pause();
        }

        let modalContentHTML = '';
        let profanityCheckResult = { profanity: false };

        if (type === "session-paused") {
            modalContentHTML = `
                <h2>Are you still there?</h2>
                <p><strong>${messageText}</strong></p>
                <div class="scribe-btn-container">
                    <button id="scribe-continue-btn">Continue</button>
                    <button id="scribe-end-btn">End</button>
                </div>
            `;
        } else {
            const word = messageText;
            const validator = await fetch(`https://www.purgomalum.com/service/json?text=${word}`);
            profanityCheckResult = await validator.json();
            let isProfane = profanityCheckResult.result.includes("*");

            if (!isProfane) {
                modalContentHTML = `
                    <h2>${word}</h2>
                    <p><strong>Definition:</strong> ${wordDefinition}</p>
                    <p><strong>Translation:</strong> ${wordTranslations}</p>
                    <button id="scribe-close-btn">Close</button>
                `;
            } else {
                modalContentHTML = `
                    <h2>Profanity Found</h2>
                    <p><strong>Sorry, this word cannot be added</p>
                    <p><strong>Try a different one</p>
                    <button id="scribe-close-btn">Close</button>
                `;
            }
        }

        const container = document.fullscreenElement || 
                        document.querySelector('.nf-player-container') || 
                        document.body;
                        
        const overlay = document.createElement('div');
        let modal;
        overlay.id = 'scribe-overlay';
        overlay.className = 'scribe-overlay';
        overlay.onclick = removeModal;
        
        modal = document.createElement('div');
        modal.id = 'scribe-modal';
        modal.className = 'scribe-modal';
        modal.innerHTML = modalContentHTML;

        container.appendChild(overlay);
        container.appendChild(modal);

        if (type == "session-paused") {   
            document.getElementById('scribe-continue-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                removeModal();
            })

            document.getElementById('scribe-end-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (type == "session-paused") {
                    removeModal();
                    timetracked = 0;
                    wordCount = 0;
                    updateCounter();
                }
            })
        } else {
            document.getElementById('scribe-close-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                removeModal();
            });
        }

        return profanityCheckResult;
    };
    
    const updateCounter = () => {
        const counter = document.getElementById('scribe-counter');
        if (counter) counter.textContent = `${wordCount}`;
    };

    const updateTimer = () => {
        const timer = document.getElementById('scribe-timer');
        if (timer) {
            const totalSeconds = Math.floor(timetracked / 1000);
            timer.textContent = formatTime(totalSeconds);
        }
    };

    const isNonSpokenLine = (line) => {
        return /^\s*\[.*?\]\s*$/.test(line);
    };

    const splitWords = (line, platform) => {
        if (platform === "youtube") {
            return line.trim().split(/\s+/).filter(Boolean);
        }
        return line
            .trim()
            .split(/\s+/)
            .map(word => word.replace(/[^a-zA-Z']/g, ''))
            .filter(Boolean);
    };

    const createUIInsideContainer = (container) => {
        if (document.getElementById('scribe-sub-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'scribe-shadow-subtitles';
        wrapper.id = 'scribe-sub-wrapper';

        const toast = document.createElement('div');
        toast.className = 'scribe-toast';
        toast.id = 'scribe-toast';

        const counter = document.createElement('div');
        counter.className = 'scribe-counter';
        counter.id = 'scribe-counter';
        counter.textContent = '0';

        const timer = document.createElement('div');
        timer.className = 'scribe-timer';
        timer.id = 'scribe-timer';
        timer.textContent = '00:00';

        container.append(wrapper, toast, counter, timer);
    };

    let wordsList = [];
    let lastProcessedYoutubeText = '';
    let lastNetflixText = '';
    const normalize = (text) => text ? text.replace(/\s+/g, ' ').trim() : '';

    const updateSubtitles = () => {
        const wrapper = document.getElementById('scribe-sub-wrapper');
        if (!wrapper) return;

        if (isYoutube()) {
            const sourceEl = document.querySelector('.captions-text');
            const rawText = sourceEl ? sourceEl.innerText.trim() : '';
            const singleLineText = rawText ? rawText.replace(/\n/g, ' ').trim() : '';
            const normalizedNewText = normalize(singleLineText);
            const normalizedLastText = normalize(lastProcessedYoutubeText);

            const nextSection = () => {
                if (wordsList.length > 0) {
                    const MAX_WORDS = 8;
                    let wordsToDisplay;

                    let sentenceEndIndex = -1;
                    for (let i = 0; i < wordsList.length && i < MAX_WORDS; i++) {
                        if (/[.?!]['"]?$/.test(wordsList[i])) {
                            sentenceEndIndex = i;
                            break;
                        }
                    }
            
                    if (sentenceEndIndex !== -1) {
                        wordsToDisplay = wordsList.splice(0, sentenceEndIndex + 1);
                    } else {
                        wordsToDisplay = wordsList.splice(0, MAX_WORDS);
                    }
                    
                    wrapper.innerHTML = '';
                    const lineDiv = document.createElement('div');
                    lineDiv.className = 'scribe-line';

                    wordsToDisplay.forEach(word => {
                        const span = document.createElement('span');
                        span.className = 'scribe-word';
                        span.textContent = word;

                        span.addEventListener('mouseenter', () => {
                            if (videoElement && !videoElement.paused && !document.getElementById('scribe-modal')) {
                                videoElement.pause();
                            }
                        });
                        span.addEventListener('mouseleave', () => {
                            if (videoElement && videoElement.paused && !document.getElementById('scribe-modal')) {
                                videoElement.play().catch(e => console.log('Video play failed:', e));
                            }
                        });

                        span.onclick = (e) => {
                            e.stopPropagation();
                            saveWord(word);
                        };

                        lineDiv.appendChild(span);
                        lineDiv.appendChild(document.createTextNode(' '));
                    });
                    wrapper.appendChild(lineDiv);
                }
            };

            if (normalizedNewText && normalizedNewText !== normalizedLastText) {
                lastProcessedYoutubeText = singleLineText;
                wordsList = splitWords(singleLineText, "youtube"); 
                nextSection(); 
            } 
            else if (!normalizedNewText && wordsList.length > 0) {
                nextSection(); 
            }

        } else if (isNetflix()) {
            const sourceEl = document.querySelector('.player-timedtext-text-container');
            const rawText = sourceEl ? sourceEl.innerText.trim() : '';
            
            if (!rawText || normalize(rawText) === normalize(lastNetflixText)) return;
            lastNetflixText = rawText;

            wrapper.innerHTML = '';
            const lines = rawText.split('\n').filter(line => !isNonSpokenLine(line));

            lines.forEach(line => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'scribe-line';
                const words = splitWords(line, 'netflix');

                words.forEach(word => {
                    if (!word) return;

                    const span = document.createElement('span');
                    span.className = 'scribe-word';
                    span.textContent = word;

                    span.addEventListener('mouseenter', () => {
                        if (videoElement && !videoElement.paused && !document.getElementById('scribe-modal')) {
                            videoElement.pause();
                        }
                    });
                    span.addEventListener('mouseleave', () => {
                        if (videoElement && videoElement.paused && !document.getElementById('scribe-modal')) {
                            videoElement.play().catch(e => console.log('Video play failed:', e));
                        }
                    });
                    span.onclick = (e) => {
                        e.stopPropagation();
                        saveWord(word);
                    };

                    lineDiv.appendChild(span);
                });
                wrapper.appendChild(lineDiv);
            });
        }
    };

    const positionScribeSubtitles = () => {
        if (isYoutube()) {
            const source = document.querySelector('.caption-window');
            const destination = document.getElementById('scribe-sub-wrapper');
            const player = document.getElementById('movie_player');

            if (source) {
                source.style.opacity = '0';
                source.style.zIndex = '-1';
            }

            if (!source || !destination || !player) {
                if (destination) destination.style.visibility = 'hidden';
                return;
            }

            destination.style.visibility = 'visible';
            const sourceRect = source.getBoundingClientRect();

            destination.style.position = 'absolute';
            destination.style.top =  `800px`
            destination.style.width = `100vw`;
            destination.style.height = `${sourceRect.height}px`;
            destination.style.zIndex = '1';
            destination.style.display = 'flex';
            destination.style.flexDirection = 'column';
            destination.style.justifyContent = 'center';
            destination.style.alignItems = 'center';

            const sourceStyle = window.getComputedStyle(source.querySelector('.ytp-caption-segment') || source);
            destination.style.textAlign = sourceStyle.textAlign;
            destination.style.fontSize = sourceStyle.fontSize;
            destination.style.fontFamily = sourceStyle.fontFamily;
        }
    };


    const youtube = () => {
        console.log("Youtube triggered")

        if (!isYoutube()) {
            return;
        }

        const findVideoElement = () => {
            if (isYoutube()) {
                function setupVideoElement() {
                    console.log("DOM LOADED");
                    videoElement = document.getElementsByClassName('video-stream html5-main-video')[0];
                    if (videoElement) {
                        if (!videoElement.paused) {
                            console.log("Currently playing")
                            startTracking()
                        }

                        videoElement.addEventListener('play', 
                            startTracking
                        );
                        videoElement.addEventListener('pause',
                            stopTracking
                        );
                    } else {
                        console.log("video element not found yet");
                    }
                    updateTimer();
                    return videoElement;
                }

                if (document.readyState === "loading") {
                    document.addEventListener('DOMContentLoaded', setupVideoElement);
                } else {
                    setupVideoElement();
                }
            }
        }

        function isVideoFullscreen() {
            return !!document.fullscreenElement;
        }

        const handleFullscreenChange = () => {
            const container = document.querySelector('#movie_player .html5-video-container');
            findVideoElement();
            if (isVideoFullscreen()) {
                console.log("Video is in fullscreen");
                const subtitlesBTN = document.getElementsByClassName('ytp-subtitles-button ytp-button')[0];
                if (subtitlesBTN && subtitlesBTN.getAttribute('aria-pressed') === 'false') {
                    subtitlesBTN.click();
                }
                createUIInsideContainer(container);
                updateSubtitles();
                positionScribeSubtitles();
                updateTimer();
            } else {
                console.log("video is not in fullscreen");
                hideOverlay();
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

        const interval = setInterval(() => {
            if (!isYoutube()) {
                clearInterval(interval);
                hideOverlay();
                return;
            }

            const ytSubtitles = document.querySelector('.caption-window');
            if (ytSubtitles) {
                ytSubtitles.style.opacity = '0';
            }

            if (isVideoFullscreen()) {
                updateSubtitles();
                positionScribeSubtitles();
            }
            updateTimer();
        }, 100);
    }

    const netflix = () => {
        if (!isNetflix()) {
            return;
        }

        const findVideoElement = () => {
            if (isNetflix()) {
                videoElement = document.querySelector('[id="81654823"] > video');
            }
            if (!videoElement) {
                videoElement = document.querySelector('video');
            }
            if (videoElement) {
                videoElement.addEventListener('play', 
                    startTracking
                );
                videoElement.addEventListener('pause', 
                    stopTracking
                );
                if (!videoElement.paused) {
                    startTracking();
                }
            }
            return videoElement;
        };

        const interval = setInterval(() => {
            if (!isNetflix()) {
                clearInterval(interval);
                hideOverlay();
                return;
            }

            const container = document.fullscreenElement || 
                           document.querySelector('.watch-video--player-view, .player-container, .video-container, .nf-player-container') ||
                           document.body;

            createUIInsideContainer(container);
            updateSubtitles();
            findVideoElement();
            updateTimer();
        }, 400);
    };
    
    let prevRoute = window.location.href;
    const checkUrlChange = () => {
        if (window.location.href !== prevRoute) {
            prevRoute = window.location.href;
            if (isNetflix()) {
                main();
            } else {
                hideOverlay();
            }
        }
    };

    if (isNetflix()){
        netflix();
    } else if (isYoutube()) {
        youtube();
    }
    setInterval(checkUrlChange, 500);
})();
