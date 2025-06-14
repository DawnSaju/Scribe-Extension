(() => {
    const platforms = ['netflix.com', 'www.netflix.com'];

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

    function isWatchPage() {
        return /^https?:\/\/(www\.)?netflix\.com\/watch\/\d+/.test(window.location.href);
    }

    const savedWords = new Set();
    let wordCount = 0;
    let videoElement = null;
    let wasPlayingBefore = false;

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
        removeModal();
        const elements = ['scribe-sub-wrapper', 'scribe-toast', 'scribe-counter'];
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
    let showData;

    function getShowData() {
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
    
        showData = {
            show_name: showName,
            season,
            episode,
            episode_title: episodeTitle
        };
    
        console.log("Done:", showData);
        return showData;
    }

    const saveWord = async (word) => {
        const lowerWord = word.toLowerCase();
            
        if (!savedWords.has(lowerWord)) {
          const verify = await showModal(word, "default");
          if (!verify?.profanity) {
            console.log('Word sent to background.js:', word);
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
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
            getShowData();
            translate(word, "ar").then(result => {
                if (result) {
                console.log("Translated Text:", result.translatedText);
                wordTranslations = result.translatedText;
                showModal(word); 
                }
            });          

            chrome.runtime.sendMessage({
                type: 'SEND_DATA',
                data: {
                    id: Math.floor(Math.random() * 1000000).toString(),
                    word: word,
                    part_of_speech: partOfSpeech,
                    is_new: true,
                    definition: definition,
                    phonetics: phonetics,
                    example: example,
                    platform: 'Netflix',
                    show_name: showData.show_name,
                    season: 1,
                    episode: showData.episode,
                }
                }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending message to background:", chrome.runtime.lastError.message);
                } else {
                    console.log("Background response:", response);
                }
            });

            console.log('Saved:', word);
          } else {
            showModal(word, "profanity");
          }
        } else {
          showToast(`Already saved: "${word}"`);
        }
    };
    
    const showModal = async (word) => {
        removeModal();
        
        wasPlayingBeforeModal = videoElement && !videoElement.paused;
        if (wasPlayingBeforeModal) {
            videoElement.pause();
        }

        const validator = await fetch(`https://www.purgomalum.com/service/json?text=${word}`);
        const json = await validator.json();

        const container = document.fullscreenElement || 
                        document.querySelector('.nf-player-container') || 
                        document.body;
                        
        const overlay = document.createElement('div');
        let modal;
        overlay.id = 'scribe-overlay';
        overlay.className = 'scribe-overlay';
        overlay.onclick = removeModal;
        let isProfane = json.result.includes("*");
        
        if (!isProfane) {
            modal = document.createElement('div');
            modal.id = 'scribe-modal';
            modal.className = 'scribe-modal';
            modal.innerHTML = `
                <h2>${word}</h2>
                <p><strong>Definition:</strong> ${wordDefinition}</p>
                <p><strong>Translation:</strong> ${wordTranslations}</p>
                <button id="scribe-close-btn">Close</button>
            `;
        } else {
            modal = document.createElement('div');
            modal.id = 'scribe-modal';
            modal.className = 'scribe-modal';
            modal.innerHTML = `
                <h2>Profanity Found</h2>
                <p><strong>Sorry, this word cannot be added</p>
                <p><strong>Try a different one</p>
                <button id="scribe-close-btn">Close</button>
            `;
        }

        container.appendChild(overlay);
        container.appendChild(modal);

        document.getElementById('scribe-close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeModal();
        });

        return { profanity: isProfane };
    };
      

    const updateCounter = () => {
        const counter = document.getElementById('scribe-counter');
        if (counter) counter.textContent = `${wordCount}`;
    };

    const isNonSpokenLine = (line) => {
        return /^\s*\[.*?\]\s*$/.test(line);
    };

    const splitWords = (line) => {
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

        container.append(wrapper, toast, counter);
    };

    let lastSubtitle = '';

    const updateSubtitles = () => {
        const sourceEl = document.querySelector('.player-timedtext-text-container');
        const wrapper = document.getElementById('scribe-sub-wrapper');
        if (!sourceEl || !wrapper) return;

        const rawText = sourceEl.innerText.trim();
        if (rawText === lastSubtitle) return;
        lastSubtitle = rawText;

        wrapper.innerHTML = '';

        const lines = rawText.split('\n').filter(line => !isNonSpokenLine(line));

        lines.forEach(line => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'scribe-line';

            const words = splitWords(line);

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
    };

    const main = () => {
        if (!isWatchPage()) {
            return;
        }

        const findVideoElement = () => {
            videoElement = document.querySelector('#\\38 1654823 > video');
            if (!videoElement) {
                videoElement = document.querySelector('video');
            }
            return videoElement;
        };

        const interval = setInterval(() => {
            if (!isWatchPage()) {
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
        }, 400);
    };

    let prevRoute = window.location.href;
    const checkUrlChange = () => {
        if (window.location.href !== prevRoute) {
            prevRoute = window.location.href;
            if (isWatchPage()) {
                main();
            } else {
                hideOverlay();
            }
        }
    };

    if (isWatchPage()){
        main();
    }
    setInterval(checkUrlChange, 500);
})();
