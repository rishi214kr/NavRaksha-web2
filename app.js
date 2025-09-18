/**
 * NavRaksha - Road Safety PWA
 * Main Application JavaScript
 */


const AppState = {
    user: null,
    location: null,
    safetyZone: null,
    isTracking: false,
    isVoiceSosActive: false,
    emergencyContacts: [],
    hazards: [],
    queuedEvents: [],
    isOnline: navigator.onLine,
    theme: 'light',
    highContrast: false,
    map: null,
    userMarker: null,
    safetyCircle: null,
    chart: null,
    recognition: null,
    lastMotionEvent: null,
    safetyCheckTimeout: null,
    currentTipIndex: 0,
    chatMessages: []
};

class DatabaseManager {
    constructor() {
        this.dbName = 'NavRakshaDB';
        this.version = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
               
                if (!db.objectStoreNames.contains('profile')) {
                    db.createObjectStore('profile', { keyPath: 'id' });
                }
                
             
                if (!db.objectStoreNames.contains('locations')) {
                    const locationStore = db.createObjectStore('locations', { keyPath: 'id', autoIncrement: true });
                    locationStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
               
                if (!db.objectStoreNames.contains('emergencies')) {
                    const emergencyStore = db.createObjectStore('emergencies', { keyPath: 'id', autoIncrement: true });
                    emergencyStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
            
                if (!db.objectStoreNames.contains('hazards')) {
                    const hazardStore = db.createObjectStore('hazards', { keyPath: 'id', autoIncrement: true });
                    hazardStore.createIndex('location', ['lat', 'lng'], { unique: false });
                }
                
               
                if (!db.objectStoreNames.contains('queue')) {
                    db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    async save(storeName, data) {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        return store.put(data);
    }

    async get(storeName, key) {
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName) {
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, key) {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        return store.delete(key);
    }
}

class NotificationManager {
    constructor() {
        this.container = document.getElementById('notifications');
    }

    show(type, title, message, duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        notification.innerHTML = `
            <div class="notification-icon">${icons[type] || 'ℹ️'}</div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <button class="notification-close">×</button>
        `;

        this.container.appendChild(notification);

        
        setTimeout(() => notification.classList.add('show'), 100);

      
        const autoRemove = setTimeout(() => this.remove(notification), duration);

      
        notification.querySelector('.notification-close').addEventListener('click', () => {
            clearTimeout(autoRemove);
            this.remove(notification);
        });

   
        if (type === 'error' || type === 'warning') {
            this.vibrate([200, 100, 200]);
        }

        return notification;
    }

    remove(notification) {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    vibrate(pattern) {
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }
}

class LocationManager {
    constructor() {
        this.watchId = null;
        this.lastKnownPosition = null;
    }

    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                position => {
                    this.lastKnownPosition = position;
                    resolve(position);
                },
                error => reject(error),
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 60000
                }
            );
        });
    }

    startTracking() {
        if (!navigator.geolocation) {
            throw new Error('Geolocation is not supported');
        }

        this.watchId = navigator.geolocation.watchPosition(
            position => {
                this.lastKnownPosition = position;
                this.handleLocationUpdate(position);
            },
            error => this.handleLocationError(error),
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 30000
            }
        );

        AppState.isTracking = true;
        this.updateGPSStatus('active', 'GPS Active');
    }

    stopTracking() {
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        AppState.isTracking = false;
        this.updateGPSStatus('inactive', 'GPS Inactive');
    }

    handleLocationUpdate(position) {
        const { latitude, longitude, accuracy } = position.coords;
        
        AppState.location = {
            lat: latitude,
            lng: longitude,
            accuracy: accuracy,
            timestamp: Date.now()
        };

       
        this.updateLocationDisplay(position);
        this.updateMapPosition(latitude, longitude);
        this.checkSafetyZone(latitude, longitude);
        
     
        this.saveLocationToDatabase(position);
      
        this.updateAccuracyMeter(accuracy);
    }

    handleLocationError(error) {
        let message = 'Unknown location error';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Location access denied by user';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Location information unavailable';
                break;
            case error.TIMEOUT:
                message = 'Location request timed out';
                break;
        }

        this.updateGPSStatus('error', 'GPS Error');
        notificationManager.show('error', 'Location Error', message);
    }

    updateGPSStatus(status, text) {
        const statusElement = document.getElementById('gpsStatus');
        const statusClasses = {
            'active': 'status-badge active',
            'searching': 'status-badge searching',
            'error': 'status-badge error',
            'inactive': 'status-badge'
        };
        
        statusElement.className = statusClasses[status] || 'status-badge';
        statusElement.textContent = text;
    }

    updateLocationDisplay(position) {
        const locationInfo = document.getElementById('locationInfo');
        const { latitude, longitude, accuracy } = position.coords;
        
        locationInfo.innerHTML = `
            <p><strong>Latitude:</strong> ${latitude.toFixed(6)}</p>
            <p><strong>Longitude:</strong> ${longitude.toFixed(6)}</p>
            <p><strong>Accuracy:</strong> ±${Math.round(accuracy)}m</p>
            <p><strong>Last Update:</strong> ${new Date().toLocaleTimeString()}</p>
        `;
    }

    updateAccuracyMeter(accuracy) {
        const meter = document.getElementById('accuracyMeter');
        const value = document.getElementById('accuracyValue');
        
        value.textContent = Math.round(accuracy);
        
        // Convert accuracy to percentage (lower is better)
        // Good: 0-10m, Fair: 10-50m, Poor: 50m+
        let percentage;
        if (accuracy <= 10) {
            percentage = 100;
        } else if (accuracy <= 50) {
            percentage = 100 - ((accuracy - 10) / 40) * 50;
        } else {
            percentage = 50 - Math.min((accuracy - 50) / 50, 1) * 50;
        }
        
        meter.style.width = `${percentage}%`;
    }

    updateMapPosition(lat, lng) {
        if (AppState.map && AppState.userMarker) {
            AppState.userMarker.setLatLng([lat, lng]);
            AppState.map.setView([lat, lng], AppState.map.getZoom());
        }
    }

    checkSafetyZone(lat, lng) {
        if (!AppState.safetyZone) return;

        const distance = this.calculateDistance(
            lat, lng,
            AppState.safetyZone.lat, AppState.safetyZone.lng
        );

        const isInside = distance <= AppState.safetyZone.radius;
        const zoneStatus = document.getElementById('zoneStatus');
        
        if (isInside) {
            zoneStatus.innerHTML = '<span class="zone-indicator safe">✅ Inside Safe Zone</span>';
        } else {
            zoneStatus.innerHTML = '<span class="zone-indicator danger">⚠️ Outside Safe Zone</span>';
            this.triggerSafetyAlert('You have left your designated safe zone!');
        }
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lng2-lng1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    triggerSafetyAlert(message) {
        notificationManager.show('warning', 'Safety Alert', message);
        notificationManager.vibrate([300, 100, 300, 100, 300]);
        
        // Play alert sound
        this.playAlertSound();
    }

    playAlertSound() {
        // Create audio context for alert sound
        if ('AudioContext' in window || 'webkitAudioContext' in window) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext();
            
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.5);
        }
    }

    async saveLocationToDatabase(position) {
        try {
            await db.save('locations', {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Failed to save location:', error);
        }
    }
}

// Emergency System Manager
class EmergencyManager {
    constructor() {
        this.sosTimeout = null;
        this.safetyCheckTimeout = null;
    }

    async triggerSOS(isAutomatic = false) {
        const location = AppState.location;
        if (!location) {
            notificationManager.show('error', 'SOS Failed', 'Location not available');
            return;
        }

        const sosData = {
            id: this.generateEmergencyId(),
            type: 'SOS',
            location: location,
            timestamp: Date.now(),
            automatic: isAutomatic,
            user: AppState.user
        };

        // Show SOS confirmation modal
        this.showSOSModal(sosData);
    }

    showSOSModal(sosData) {
        const modal = document.getElementById('sosModal');
        const countdown = document.getElementById('sosCountdown');
        const countdownText = document.getElementById('countdownText');
        
        let timeLeft = 5;
        countdown.textContent = timeLeft;
        countdownText.textContent = timeLeft;
        
        modal.classList.add('open');
        
        const countdownInterval = setInterval(() => {
            timeLeft--;
            countdown.textContent = timeLeft;
            countdownText.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                this.sendSOS(sosData);
                modal.classList.remove('open');
            }
        }, 1000);

        // Confirm SOS immediately
        document.getElementById('confirmSos').onclick = () => {
            clearInterval(countdownInterval);
            this.sendSOS(sosData);
            modal.classList.remove('open');
        };

        // Cancel SOS
        document.getElementById('cancelSos').onclick = () => {
            clearInterval(countdownInterval);
            modal.classList.remove('open');
            notificationManager.show('info', 'SOS Cancelled', 'Emergency request was cancelled');
        };
    }

    async sendSOS(sosData) {
        try {
            // Save to local database first
            await db.save('emergencies', sosData);
            
            // Try to send to server
            if (AppState.isOnline) {
                await this.sendToServer('/api/emergency/sos', sosData);
                notificationManager.show('success', 'SOS Sent', 'Emergency services have been notified');
            } else {
                // Queue for later sync
                await db.save('queue', {
                    type: 'emergency',
                    data: sosData,
                    timestamp: Date.now()
                });
                notificationManager.show('warning', 'SOS Queued', 'Will send when connection is restored');
            }

            // Update emergency status
            this.updateEmergencyStatus('SOS Sent');
            
            // Vibrate and play sound
            notificationManager.vibrate([500, 200, 500, 200, 500]);
            this.playEmergencySound();
            
        } catch (error) {
            console.error('Failed to send SOS:', error);
            notificationManager.show('error', 'SOS Failed', 'Failed to send emergency request');
        }
    }

    async sendToServer(endpoint, data) {
        // Mock API call - replace with actual endpoint
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (Math.random() > 0.1) { // 90% success rate
                    resolve({ success: true, id: data.id });
                } else {
                    reject(new Error('Server error'));
                }
            }, 1000);
        });
    }

    generateEmergencyId() {
        return 'EMG_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    updateEmergencyStatus(status) {
        const statusElement = document.getElementById('emergencyStatus');
        statusElement.textContent = status;
        
        const lastCheck = document.getElementById('lastSafetyCheck');
        lastCheck.textContent = `Last check: ${new Date().toLocaleTimeString()}`;
    }

    playEmergencySound() {
        // Create emergency sound pattern
        if ('AudioContext' in window || 'webkitAudioContext' in window) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext();
            
            // Create siren-like sound
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                    oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.5);
                    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                    
                    oscillator.start();
                    oscillator.stop(audioContext.currentTime + 0.5);
                }, i * 600);
            }
        }
    }

    startSafetyCheck() {
        this.showSafetyCheckModal();
    }

    showSafetyCheckModal() {
        const modal = document.getElementById('safetyCheckModal');
        const countdown = document.getElementById('checkCountdown');
        
        let timeLeft = 30;
        countdown.textContent = timeLeft;
        
        modal.classList.add('open');
        
        const countdownInterval = setInterval(() => {
            timeLeft--;
            countdown.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                // Auto-trigger SOS if no response
                this.triggerSOS(true);
                modal.classList.remove('open');
            }
        }, 1000);

        // User confirms they're safe
        document.getElementById('confirmSafe').onclick = () => {
            clearInterval(countdownInterval);
            modal.classList.remove('open');
            this.updateEmergencyStatus('Safe - Confirmed');
            notificationManager.show('success', 'Safety Confirmed', 'Thank you for confirming your safety');
        };

        // User needs help
        document.getElementById('needHelp').onclick = () => {
            clearInterval(countdownInterval);
            modal.classList.remove('open');
            this.triggerSOS(false);
        };
    }
}

// Voice Recognition for SOS
class VoiceManager {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.initSpeechRecognition();
    }

    initSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            
            this.recognition.continuous = true;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';
            
            this.recognition.onresult = (event) => {
                const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
                console.log('Voice input:', transcript);
                
                if (transcript.includes('help') || transcript.includes('sos') || transcript.includes('emergency')) {
                    this.triggerVoiceSOS();
                }
            };
            
            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                if (event.error === 'not-allowed') {
                    notificationManager.show('error', 'Voice SOS', 'Microphone access denied');
                }
            };
            
            this.recognition.onend = () => {
                if (this.isListening) {
                    // Restart recognition if it was supposed to be listening
                    setTimeout(() => this.recognition.start(), 1000);
                }
            };
        }
    }

    startListening() {
        if (!this.recognition) {
            notificationManager.show('error', 'Voice SOS', 'Speech recognition not supported');
            return;
        }

        try {
            this.recognition.start();
            this.isListening = true;
            AppState.isVoiceSosActive = true;
            
            const button = document.getElementById('voiceSosToggle');
            button.textContent = '🎤 Listening...';
            button.style.background = 'var(--safe-green)';
            button.style.color = 'white';
            
            notificationManager.show('info', 'Voice SOS Active', 'Say "help" or "SOS" to trigger emergency');
        } catch (error) {
            console.error('Failed to start voice recognition:', error);
            notificationManager.show('error', 'Voice SOS', 'Failed to start voice recognition');
        }
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
            this.isListening = false;
            AppState.isVoiceSosActive = false;
            
            const button = document.getElementById('voiceSosToggle');
            button.textContent = '🎤 Voice SOS';
            button.style.background = '';
            button.style.color = '';
            
            notificationManager.show('info', 'Voice SOS Disabled', 'Voice emergency detection stopped');
        }
    }

    triggerVoiceSOS() {
        notificationManager.show('warning', 'Voice SOS Detected', 'Emergency keyword detected!');
        notificationManager.vibrate([200, 100, 200, 100, 200]);
        emergencyManager.triggerSOS(false);
    }

    toggle() {
        if (this.isListening) {
            this.stopListening();
        } else {
            this.startListening();
        }
    }
}

// Motion Detection for Fall Detection
class MotionManager {
    constructor() {
        this.isMonitoring = false;
        this.lastAcceleration = null;
        this.fallThreshold = 15; // m/s²
        this.inactivityThreshold = 30000; // 30 seconds
        this.lastMotionTime = Date.now();
        this.inactivityTimer = null;
    }

    startMonitoring() {
        if ('DeviceMotionEvent' in window) {
            window.addEventListener('devicemotion', this.handleMotion.bind(this));
            this.isMonitoring = true;
            
            // Start inactivity monitoring
            this.startInactivityMonitoring();
            
            notificationManager.show('info', 'Motion Detection', 'Fall detection is now active');
        } else {
            console.log('Device motion not supported');
        }
    }

    handleMotion(event) {
        const acceleration = event.accelerationIncludingGravity;
        if (!acceleration) return;

        const { x, y, z } = acceleration;
        const totalAcceleration = Math.sqrt(x*x + y*y + z*z);
        
        // Update last motion time
        this.lastMotionTime = Date.now();
        
        // Check for sudden acceleration (potential fall)
        if (this.lastAcceleration) {
            const accelerationChange = Math.abs(totalAcceleration - this.lastAcceleration);
            
            if (accelerationChange > this.fallThreshold) {
                this.detectPotentialFall();
            }
        }
        
        this.lastAcceleration = totalAcceleration;
        AppState.lastMotionEvent = {
            acceleration: totalAcceleration,
            timestamp: Date.now()
        };
    }

    detectPotentialFall() {
        notificationManager.show('warning', 'Fall Detected', 'Sudden motion detected - checking your safety');
        notificationManager.vibrate([300, 100, 300]);
        
        // Wait a moment then check for inactivity
        setTimeout(() => {
            const timeSinceMotion = Date.now() - this.lastMotionTime;
            if (timeSinceMotion > 5000) { // 5 seconds of inactivity after fall
                emergencyManager.startSafetyCheck();
            }
        }, 5000);
    }

    startInactivityMonitoring() {
        this.inactivityTimer = setInterval(() => {
            const timeSinceMotion = Date.now() - this.lastMotionTime;
            
            if (timeSinceMotion > this.inactivityThreshold) {
                this.detectInactivity();
            }
        }, 10000); // Check every 10 seconds
    }

    detectInactivity() {
        const timeSinceMotion = Date.now() - this.lastMotionTime;
        const minutesInactive = Math.floor(timeSinceMotion / 60000);
        
        if (minutesInactive >= 30) { // 30 minutes of inactivity
            notificationManager.show('warning', 'Inactivity Detected', 
                `No movement detected for ${minutesInactive} minutes`);
            emergencyManager.startSafetyCheck();
        }
    }

    stopMonitoring() {
        if (this.isMonitoring) {
            window.removeEventListener('devicemotion', this.handleMotion.bind(this));
            this.isMonitoring = false;
            
            if (this.inactivityTimer) {
                clearInterval(this.inactivityTimer);
                this.inactivityTimer = null;
            }
        }
    }
}

// Map Manager using Leaflet
class MapManager {
    constructor() {
        this.map = null;
        this.userMarker = null;
        this.safetyCircle = null;
        this.hazardMarkers = [];
        this.trafficLayer = null;
    }

    async initMap() {
        // Initialize map centered on user location or default
        const defaultLocation = [28.6139, 77.2090]; // New Delhi
        let center = defaultLocation;
        
        if (AppState.location) {
            center = [AppState.location.lat, AppState.location.lng];
        }

        this.map = L.map('map').setView(center, 13);
        AppState.map = this.map;

        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        // Add user marker
        this.addUserMarker(center);
        
        // Load hazards from database
        await this.loadHazards();
        
        // Map click handler for reporting hazards
        this.map.on('click', (e) => {
            if (this.isReportingMode) {
                this.showHazardReportModal(e.latlng);
            }
        });
    }

    addUserMarker(position) {
        const userIcon = L.divIcon({
            className: 'user-marker',
            html: '<div style="background: #dc2626; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        this.userMarker = L.marker(position, { icon: userIcon }).addTo(this.map);
        this.userMarker.bindPopup('Your Location').openPopup();
        AppState.userMarker = this.userMarker;
    }

    setSafetyZone(center, radius) {
        // Remove existing safety circle
        if (this.safetyCircle) {
            this.map.removeLayer(this.safetyCircle);
        }

        // Add new safety circle
        this.safetyCircle = L.circle(center, {
            color: '#059669',
            fillColor: '#059669',
            fillOpacity: 0.1,
            radius: radius
        }).addTo(this.map);

        AppState.safetyCircle = this.safetyCircle;
        AppState.safetyZone = {
            lat: center[0],
            lng: center[1],
            radius: radius
        };

        notificationManager.show('success', 'Safety Zone Set', 
            `Safety zone set with ${radius}m radius`);
    }

    centerOnUser() {
        if (AppState.location && this.map) {
            this.map.setView([AppState.location.lat, AppState.location.lng], 15);
        } else {
            notificationManager.show('warning', 'Location Unavailable', 
                'Cannot center map - location not available');
        }
    }

    async addHazard(hazard) {
        const hazardIcon = this.getHazardIcon(hazard.type);
        const marker = L.marker([hazard.lat, hazard.lng], { icon: hazardIcon }).addTo(this.map);
        
        marker.bindPopup(`
            <div class="hazard-popup">
                <h4>${this.getHazardTitle(hazard.type)}</h4>
                <p>${hazard.description}</p>
                <p><strong>Severity:</strong> ${hazard.severity}</p>
                <p><small>Reported: ${new Date(hazard.timestamp).toLocaleString()}</small></p>
            </div>
        `);

        this.hazardMarkers.push(marker);
        
        // Save to database
        await db.save('hazards', hazard);
    }

    getHazardIcon(type) {
        const icons = {
            pothole: '🕳️',
            accident: '🚗',
            construction: '🚧',
            flooding: '🌊',
            debris: '🪨',
            other: '⚠️'
        };

        return L.divIcon({
            className: 'hazard-marker',
            html: `<div style="background: #f59e0b; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${icons[type] || '⚠️'}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
    }

    getHazardTitle(type) {
        const titles = {
            pothole: 'Pothole',
            accident: 'Accident',
            construction: 'Construction Work',
            flooding: 'Flooding',
            debris: 'Road Debris',
            other: 'Road Hazard'
        };
        return titles[type] || 'Road Hazard';
    }

    async loadHazards() {
        try {
            const hazards = await db.getAll('hazards');
            hazards.forEach(hazard => {
                const hazardIcon = this.getHazardIcon(hazard.type);
                const marker = L.marker([hazard.lat, hazard.lng], { icon: hazardIcon }).addTo(this.map);
                
                marker.bindPopup(`
                    <div class="hazard-popup">
                        <h4>${this.getHazardTitle(hazard.type)}</h4>
                        <p>${hazard.description}</p>
                        <p><strong>Severity:</strong> ${hazard.severity}</p>
                        <p><small>Reported: ${new Date(hazard.timestamp).toLocaleString()}</small></p>
                    </div>
                `);

                this.hazardMarkers.push(marker);
            });
        } catch (error) {
            console.error('Failed to load hazards:', error);
        }
    }

    showHazardReportModal(latlng) {
        const modal = document.getElementById('hazardModal');
        modal.classList.add('open');
        
        // Store the location for the report
        this.reportLocation = latlng;
    }

    toggleTraffic() {
        // Mock traffic layer toggle
        if (this.trafficLayer) {
            this.map.removeLayer(this.trafficLayer);
            this.trafficLayer = null;
            notificationManager.show('info', 'Traffic Layer', 'Traffic layer disabled');
        } else {
            // Add mock traffic incidents
            this.addMockTrafficIncidents();
            notificationManager.show('info', 'Traffic Layer', 'Traffic layer enabled');
        }
    }

    addMockTrafficIncidents() {
        const incidents = [
            { lat: 28.6129, lng: 77.2295, type: 'Heavy Traffic', severity: 'medium' },
            { lat: 28.6169, lng: 77.2090, type: 'Road Closure', severity: 'high' },
            { lat: 28.6089, lng: 77.2190, type: 'Slow Traffic', severity: 'low' }
        ];

        incidents.forEach(incident => {
            const color = incident.severity === 'high' ? '#dc2626' : 
                         incident.severity === 'medium' ? '#f59e0b' : '#059669';
            
            const marker = L.circleMarker([incident.lat, incident.lng], {
                color: color,
                fillColor: color,
                fillOpacity: 0.7,
                radius: 8
            }).addTo(this.map);

            marker.bindPopup(`
                <div class="traffic-popup">
                    <h4>${incident.type}</h4>
                    <p>Severity: ${incident.severity}</p>
                </div>
            `);
        });
    }
}

// Analytics and Chart Manager
class AnalyticsManager {
    constructor() {
        this.chart = null;
        this.initChart();
    }

    initChart() {
        const ctx = document.getElementById('safetyChart').getContext('2d');
        
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.generateTimeLabels(),
                datasets: [{
                    label: 'Safety Events',
                    data: this.generateMockData(),
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    tension: 0.4,
                    fill: true
                }, {
                    label: 'Location Updates',
                    data: this.generateMockLocationData(),
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    }
                }
            }
        });

        AppState.chart = this.chart;
        
        // Update chart periodically
        setInterval(() => this.updateChart(), 30000); // Update every 30 seconds
    }

    generateTimeLabels() {
        const labels = [];
        const now = new Date();
        
        for (let i = 23; i >= 0; i--) {
            const time = new Date(now.getTime() - i * 60 * 60 * 1000);
            labels.push(time.getHours() + ':00');
        }
        
        return labels;
    }

    generateMockData() {
        return Array.from({ length: 24 }, () => Math.floor(Math.random() * 10));
    }

    generateMockLocationData() {
        return Array.from({ length: 24 }, () => Math.floor(Math.random() * 50) + 10);
    }

    updateChart() {
        if (this.chart) {
            // Add new data point
            const newSafetyData = Math.floor(Math.random() * 10);
            const newLocationData = Math.floor(Math.random() * 50) + 10;
            
            this.chart.data.datasets[0].data.push(newSafetyData);
            this.chart.data.datasets[1].data.push(newLocationData);
            
            // Remove old data point
            this.chart.data.datasets[0].data.shift();
            this.chart.data.datasets[1].data.shift();
            
            // Update labels
            const now = new Date();
            this.chart.data.labels.push(now.getHours() + ':' + now.getMinutes().toString().padStart(2, '0'));
            this.chart.data.labels.shift();
            
            this.chart.update('none');
        }
    }

    updatePeriod(period) {
        // Update chart based on selected period
        let labels, data1, data2;
        
        switch(period) {
            case 'today':
                labels = this.generateTimeLabels();
                data1 = this.generateMockData();
                data2 = this.generateMockLocationData();
                break;
            case 'week':
                labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                data1 = Array.from({ length: 7 }, () => Math.floor(Math.random() * 50));
                data2 = Array.from({ length: 7 }, () => Math.floor(Math.random() * 200) + 50);
                break;
            case 'month':
                labels = Array.from({ length: 30 }, (_, i) => `Day ${i + 1}`);
                data1 = Array.from({ length: 30 }, () => Math.floor(Math.random() * 100));
                data2 = Array.from({ length: 30 }, () => Math.floor(Math.random() * 500) + 100);
                break;
        }
        
        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = data1;
        this.chart.data.datasets[1].data = data2;
        this.chart.update();
    }
}

// User Profile Manager
class ProfileManager {
    constructor() {
        this.profile = null;
    }

    async loadProfile() {
        try {
            this.profile = await db.get('profile', 'user');
            if (this.profile) {
                this.displayProfile();
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
        }
    }

    async saveProfile(profileData) {
        try {
            const profile = {
                id: 'user',
                ...profileData,
                safetyId: this.generateSafetyId(),
                createdAt: Date.now()
            };

            await db.save('profile', profile);
            this.profile = profile;
            this.displayProfile();
            
            notificationManager.show('success', 'Profile Created', 
                'Your digital safety ID has been created');
        } catch (error) {
            console.error('Failed to save profile:', error);
            notificationManager.show('error', 'Profile Error', 
                'Failed to save profile');
        }
    }

    generateSafetyId() {
        // Generate a blockchain-style ID using SHA-256
        const data = Date.now() + Math.random().toString();
        return this.sha256(data).substring(0, 16).toUpperCase();
    }

    async sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    displayProfile() {
        const profileContent = document.getElementById('profileContent');
        
        if (!this.profile) {
            profileContent.innerHTML = '<button class="btn-primary" id="setupProfile">Setup Your Profile</button>';
            return;
        }

        profileContent.innerHTML = `
            <div class="profile-display">
                <div class="profile-info">
                    <div class="info-item">
                        <span class="info-label">Name:</span>
                        <span class="info-value">${this.profile.name}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Email:</span>
                        <span class="info-value">${this.profile.email}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Phone:</span>
                        <span class="info-value">${this.profile.phone}</span>
                    </div>
                    ${this.profile.emergencyContact ? `
                    <div class="info-item">
                        <span class="info-label">Emergency Contact:</span>
                        <span class="info-value">${this.profile.emergencyContact}</span>
                    </div>
                    ` : ''}
                    ${this.profile.bloodGroup ? `
                    <div class="info-item">
                        <span class="info-label">Blood Group:</span>
                        <span class="info-value">${this.profile.bloodGroup}</span>
                    </div>
                    ` : ''}
                </div>
                <div class="qr-container">
                    <div class="qr-code" id="qrCode"></div>
                    <div class="safety-id">ID: ${this.profile.safetyId}</div>
                </div>
            </div>
        `;

        // Generate QR code
        this.generateQRCode();
    }

    generateQRCode() {
        const qrContainer = document.getElementById('qrCode');
        if (qrContainer && this.profile) {
            const qrData = JSON.stringify({
                name: this.profile.name,
                phone: this.profile.phone,
                emergencyContact: this.profile.emergencyContact,
                bloodGroup: this.profile.bloodGroup,
                allergies: this.profile.allergies,
                safetyId: this.profile.safetyId
            });

            QRCode.toCanvas(qrContainer, qrData, {
                width: 150,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            }, (error) => {
                if (error) {
                    console.error('QR Code generation failed:', error);
                    qrContainer.innerHTML = '<p>QR Code generation failed</p>';
                }
            });
        }
    }
}

// Safety Tips Carousel Manager
class TipsManager {
    constructor() {
        this.tips = [
            {
                icon: '🪖',
                title: 'Wear Your Helmet',
                description: 'Always wear a properly fitted helmet when riding motorcycles or bicycles.'
            },
            {
                icon: '🔒',
                title: 'Buckle Up',
                description: 'Seat belts reduce the risk of death by 45% and serious injury by 50%.'
            },
            {
                icon: '📱',
                title: 'No Phone Zone',
                description: 'Keep your phone away while driving. Pull over safely if you must use it.'
            },
            {
                icon: '🌙',
                title: 'Night Driving',
                description: 'Reduce speed and increase following distance when driving at night.'
            },
            {
                icon: '🚦',
                title: 'Follow Traffic Rules',
                description: 'Always obey traffic signals and road signs for everyone\'s safety.'
            },
            {
                icon: '👀',
                title: 'Stay Alert',
                description: 'Keep your eyes on the road and be aware of your surroundings.'
            }
        ];
        
        this.currentIndex = 0;
        this.initCarousel();
    }

    initCarousel() {
        this.renderTips();
        this.createDots();
        this.startAutoRotation();
    }

    renderTips() {
        const carousel = document.getElementById('tipsCarousel');
        carousel.innerHTML = '';

        this.tips.forEach((tip, index) => {
            const tipCard = document.createElement('div');
            tipCard.className = `tip-card ${index === this.currentIndex ? 'active' : ''}`;
            tipCard.innerHTML = `
                <div class="tip-icon">${tip.icon}</div>
                <h4>${tip.title}</h4>
                <p>${tip.description}</p>
            `;
            carousel.appendChild(tipCard);
        });
    }

    createDots() {
        const dotsContainer = document.getElementById('carouselDots');
        dotsContainer.innerHTML = '';

        this.tips.forEach((_, index) => {
            const dot = document.createElement('div');
            dot.className = `carousel-dot ${index === this.currentIndex ? 'active' : ''}`;
            dot.addEventListener('click', () => this.goToSlide(index));
            dotsContainer.appendChild(dot);
        });
    }

    goToSlide(index) {
        const cards = document.querySelectorAll('.tip-card');
        const dots = document.querySelectorAll('.carousel-dot');

        // Remove active class from current
        cards[this.currentIndex].classList.remove('active');
        dots[this.currentIndex].classList.remove('active');

        // Add active class to new
        this.currentIndex = index;
        cards[this.currentIndex].classList.add('active');
        dots[this.currentIndex].classList.add('active');
    }

    nextSlide() {
        const nextIndex = (this.currentIndex + 1) % this.tips.length;
        this.goToSlide(nextIndex);
    }

    startAutoRotation() {
        setInterval(() => {
            this.nextSlide();
        }, 5000); // Change slide every 5 seconds
    }
}

// Chat Bot Manager
class ChatManager {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.responses = {
            'hello': 'Hello! I\'m here to help with road safety questions.',
            'help': 'I can help you with road safety tips, emergency procedures, and first aid guidance.',
            'emergency': 'In case of emergency, press the SOS button or say "SOS" if voice detection is enabled.',
            'first aid': 'For basic first aid: 1) Check for consciousness 2) Call for help 3) Check breathing 4) Apply pressure to bleeding wounds',
            'accident': 'If you witness an accident: 1) Ensure your safety first 2) Call emergency services 3) Provide first aid if trained 4) Direct traffic if safe',
            'helmet': 'Always wear a helmet when riding motorcycles or bicycles. It reduces head injury risk by 70%.',
            'seatbelt': 'Seat belts save lives! They reduce death risk by 45% and serious injury by 50%.',
            'night driving': 'Night driving tips: Reduce speed, increase following distance, use headlights properly, avoid looking at oncoming lights.',
            'rain': 'Driving in rain: Slow down, increase following distance, use headlights, avoid sudden movements, check tire tread.',
            'default': 'I\'m here to help with road safety questions. Try asking about emergencies, first aid, or driving tips.'
        };
    }

    toggle() {
        const widget = document.getElementById('chatWidget');
        const toggle = document.getElementById('chatToggle');
        
        if (this.isOpen) {
            widget.classList.remove('open');
            toggle.style.display = 'block';
            this.isOpen = false;
        } else {
            widget.classList.add('open');
            toggle.style.display = 'none';
            this.isOpen = true;
        }
    }

    sendMessage(message) {
        if (!message.trim()) return;

        // Add user message
        this.addMessage('user', message);
        
        // Generate bot response
        setTimeout(() => {
            const response = this.generateResponse(message.toLowerCase());
            this.addMessage('bot', response);
        }, 500);

        // Clear input
        document.getElementById('chatInput').value = '';
    }

    addMessage(sender, text) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        
        messageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(messageDiv);
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Store message
        this.messages.push({ sender, text, timestamp: Date.now() });
    }

    generateResponse(message) {
        // Simple keyword matching
        for (const [keyword, response] of Object.entries(this.responses)) {
            if (message.includes(keyword)) {
                return response;
            }
        }
        return this.responses.default;
    }
}

// Theme Manager
class ThemeManager {
    constructor() {
        this.currentTheme = localStorage.getItem('theme') || 'light';
        this.highContrast = localStorage.getItem('highContrast') === 'true';
        this.applyTheme();
    }

    toggleTheme() {
        this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        localStorage.setItem('theme', this.currentTheme);
        
        const button = document.getElementById('themeToggle');
        button.textContent = this.currentTheme === 'light' ? '🌙' : '☀️';
    }

    toggleHighContrast() {
        this.highContrast = !this.highContrast;
        this.applyTheme();
        localStorage.setItem('highContrast', this.highContrast);
        
        notificationManager.show('info', 'Accessibility', 
            `High contrast ${this.highContrast ? 'enabled' : 'disabled'}`);
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        document.documentElement.setAttribute('data-contrast', this.highContrast ? 'high' : 'normal');
        
        // Update theme toggle button
        const button = document.getElementById('themeToggle');
        if (button) {
            button.textContent = this.currentTheme === 'light' ? '🌙' : '☀️';
        }
    }

    // Auto theme based on time
    autoTheme() {
        const hour = new Date().getHours();
        const shouldBeDark = hour < 6 || hour > 18;
        
        if ((shouldBeDark && this.currentTheme === 'light') || 
            (!shouldBeDark && this.currentTheme === 'dark')) {
            this.toggleTheme();
        }
    }
}

// Offline Sync Manager
class SyncManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.setupEventListeners();
    }

    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            AppState.isOnline = true;
            this.updateNetworkStatus();
            this.syncQueuedEvents();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            AppState.isOnline = false;
            this.updateNetworkStatus();
        });
    }

    updateNetworkStatus() {
        const statusElement = document.getElementById('networkStatus');
        const dot = statusElement.querySelector('.status-dot');
        const text = statusElement.querySelector('.status-text');
        
        if (this.isOnline) {
            dot.className = 'status-dot online';
            text.textContent = 'Online';
        } else {
            dot.className = 'status-dot offline';
            text.textContent = 'Offline';
        }
    }

    async syncQueuedEvents() {
        try {
            const queuedEvents = await db.getAll('queue');
            
            for (const event of queuedEvents) {
                try {
                    // Attempt to sync event
                    await this.syncEvent(event);
                    // Remove from queue on success
                    await db.delete('queue', event.id);
                } catch (error) {
                    console.error('Failed to sync event:', error);
                }
            }
            
            if (queuedEvents.length > 0) {
                notificationManager.show('success', 'Sync Complete', 
                    `${queuedEvents.length} events synced`);
            }
        } catch (error) {
            console.error('Sync failed:', error);
        }
    }

    async syncEvent(event) {
    
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (Math.random() > 0.1) { // 90% success rate
                    resolve();
                } else {
                    reject(new Error('Sync failed'));
                }
            }, 1000);
        });
    }
}

let db, notificationManager, locationManager, emergencyManager, voiceManager, 
    motionManager, mapManager, analyticsManager, profileManager, tipsManager, 
    chatManager, themeManager, syncManager;

async function initApp() {
    try {
        db = new DatabaseManager();
        await db.init();
        
    
        notificationManager = new NotificationManager();
        locationManager = new LocationManager();
        emergencyManager = new EmergencyManager();
        voiceManager = new VoiceManager();
        motionManager = new MotionManager();
        mapManager = new MapManager();
        analyticsManager = new AnalyticsManager();
        profileManager = new ProfileManager();
        tipsManager = new TipsManager();
        chatManager = new ChatManager();
        themeManager = new ThemeManager();
        syncManager = new SyncManager();
        
       
        await mapManager.initMap();
     
        await profileManager.loadProfile();
        
        
        setupEventListeners();
    
        try {
            await locationManager.getCurrentPosition();
            locationManager.startTracking();
        } catch (error) {
            console.error('Location access denied:', error);
            notificationManager.show('warning', 'Location Access', 
                'Location access is required for full functionality');
        }
        
       
        motionManager.startMonitoring();
        
       
        themeManager.autoTheme();
        
        updateHeroStats();
        setInterval(updateHeroStats, 30000);
     
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js')
                .then(registration => {
                    console.log('Service Worker registered:', registration);
                })
                .catch(error => {
                    console.error('Service Worker registration failed:', error);
                });
        }
        
        notificationManager.show('success', 'NavRaksha Ready', 
            'Your road safety companion is now active');
            
    } catch (error) {
        console.error('App initialization failed:', error);
        notificationManager.show('error', 'Initialization Failed', 
            'Failed to initialize the application');
    }
}

function setupEventListeners() {
    
    document.getElementById('themeToggle').addEventListener('click', () => {
        themeManager.toggleTheme();
    });
    
  
    document.getElementById('accessibilityToggle').addEventListener('click', () => {
        themeManager.toggleHighContrast();
    });
    
   
    document.getElementById('zoneRadius').addEventListener('input', (e) => {
        document.getElementById('radiusValue').textContent = e.target.value;
    });
    
    document.getElementById('setSafetyZone').addEventListener('click', () => {
        if (AppState.location) {
            const radius = parseInt(document.getElementById('zoneRadius').value);
            mapManager.setSafetyZone([AppState.location.lat, AppState.location.lng], radius);
        } else {
            notificationManager.show('warning', 'Location Required', 
                'Location is required to set safety zone');
        }
    });
    
 
    document.getElementById('sosButton').addEventListener('click', () => {
        emergencyManager.triggerSOS(false);
    });
    
    document.getElementById('floatingSos').addEventListener('click', () => {
        emergencyManager.triggerSOS(false);
    });
    
    document.getElementById('voiceSosToggle').addEventListener('click', () => {
        voiceManager.toggle();
    });
    
    
    document.getElementById('centerMap').addEventListener('click', () => {
        mapManager.centerOnUser();
    });
    
    document.getElementById('reportHazard').addEventListener('click', () => {
        mapManager.isReportingMode = true;
        notificationManager.show('info', 'Hazard Reporting', 
            'Click on the map to report a hazard');
        setTimeout(() => {
            mapManager.isReportingMode = false;
        }, 30000); 
    });
    
    document.getElementById('toggleTraffic').addEventListener('click', () => {
        mapManager.toggleTraffic();
    });
    
    
    document.addEventListener('click', (e) => {
        if (e.target.id === 'setupProfile') {
            document.getElementById('profileModal').classList.add('open');
        }
    });
    

    document.getElementById('profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const profileData = {
            name: formData.get('userName') || document.getElementById('userName').value,
            email: formData.get('userEmail') || document.getElementById('userEmail').value,
            phone: formData.get('userPhone') || document.getElementById('userPhone').value,
            emergencyContact: formData.get('emergencyContact') || document.getElementById('emergencyContact').value,
            bloodGroup: formData.get('bloodGroup') || document.getElementById('bloodGroup').value,
            allergies: formData.get('allergies') || document.getElementById('allergies').value
        };
        
        await profileManager.saveProfile(profileData);
        document.getElementById('profileModal').classList.remove('open');
    });
    

    document.getElementById('hazardForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!mapManager.reportLocation) {
            notificationManager.show('error', 'Location Required', 
                'Please click on the map to select a location');
            return;
        }
        
        const formData = new FormData(e.target);
        const hazardData = {
            type: formData.get('hazardType') || document.getElementById('hazardType').value,
            description: formData.get('hazardDescription') || document.getElementById('hazardDescription').value,
            severity: formData.get('hazardSeverity') || document.getElementById('hazardSeverity').value,
            lat: mapManager.reportLocation.lat,
            lng: mapManager.reportLocation.lng,
            timestamp: Date.now(),
            reporter: AppState.user?.name || 'Anonymous'
        };
        
        await mapManager.addHazard(hazardData);
        document.getElementById('hazardModal').classList.remove('open');
        document.getElementById('hazardForm').reset();
        mapManager.reportLocation = null;
        
        notificationManager.show('success', 'Hazard Reported', 
            'Thank you for reporting the road hazard');
    });
    
    
    document.getElementById('chartPeriod').addEventListener('change', (e) => {
        analyticsManager.updatePeriod(e.target.value);
    });
    

    document.getElementById('chatToggle').addEventListener('click', () => {
        chatManager.toggle();
    });
    
    document.getElementById('chatClose').addEventListener('click', () => {
        chatManager.toggle();
    });
    
    document.getElementById('chatSend').addEventListener('click', () => {
        const input = document.getElementById('chatInput');
        chatManager.sendMessage(input.value);
    });
    
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            chatManager.sendMessage(e.target.value);
        }
    });
    
    document.querySelectorAll('.modal-close').forEach(button => {
        button.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            modal.classList.remove('open');
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('open');
            }
        });
    });
    
  
    document.addEventListener('keydown', (e) => {
     
        if (e.key.toLowerCase() === 's' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            emergencyManager.triggerSOS(false);
        }
        
      
        if (e.key.toLowerCase() === 'm' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            mapManager.centerOnUser();
        }
        

        if (e.key.toLowerCase() === 't' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            themeManager.toggleTheme();
        }
        
     
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.open').forEach(modal => {
                modal.classList.remove('open');
            });
        }
    });
}


function updateHeroStats() {
    const activeUsers = document.getElementById('activeUsers');
    const emergenciesHandled = document.getElementById('emergenciesHandled');
    

    const currentActive = parseInt(activeUsers.textContent.replace(',', ''));
    const currentEmergencies = parseInt(emergenciesHandled.textContent);
    
    activeUsers.textContent = (currentActive + Math.floor(Math.random() * 10 - 5)).toLocaleString();
    emergenciesHandled.textContent = currentEmergencies + Math.floor(Math.random() * 3);
}

document.addEventListener('DOMContentLoaded', initApp);


let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
 
    const notification = notificationManager.show('info', 'Install NavRaksha', 
        'Install NavRaksha as an app for better experience', 10000);
    
    notification.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            
            if (outcome === 'accepted') {
                notificationManager.show('success', 'App Installed', 
                    'NavRaksha has been installed successfully');
            }
            
            deferredPrompt = null;
        }
    });
});


window.addEventListener('appinstalled', () => {
    notificationManager.show('success', 'Installation Complete', 
        'NavRaksha is now installed on your device');
});


window.NavRaksha = {
    AppState,
    db,
    notificationManager,
    locationManager,
    emergencyManager,
    voiceManager,
    motionManager,
    mapManager,
    analyticsManager,
    profileManager,
    tipsManager,
    chatManager,
    themeManager,
    syncManager
};