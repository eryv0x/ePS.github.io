/**
 * GPS Tracking Module for ePS
 * Handles driver location tracking, store proximity detection, and auto-popup notifications
 */

class GPSTracker {
    constructor(options = {}) {
        this.options = {
            proximityRadius: options.proximityRadius || 500, // meters
            updateInterval: options.updateInterval || 5000, // milliseconds
            googleMapsApiKey: options.googleMapsApiKey || '',
            ...options
        };
        
        this.currentPosition = null;
        this.map = null;
        this.userMarker = null;
        this.storeMarkers = {};
        this.watchId = null;
        this.proximityAlerts = {}; // Track which stores have already triggered alerts
        this.isTracking = false;
    }

    // Small inline translation helper for user-visible GPS strings
    getTranslation(key) {
        const lang = localStorage.getItem('eps_language') || 'en';
        const map = {
            en: {
                yourLocation: 'Your Location',
                arrived: "You've arrived at",
                noStoresWithGPS: 'No stores with GPS coordinates',
                nearby: 'NEARBY'
            },
            bg: {
                yourLocation: 'Вашето местоположение',
                arrived: 'Пристигнал(а) си при',
                noStoresWithGPS: 'Няма магазини с GPS координати',
                nearby: 'БЛИЗО'
            }
        };
        return (map[lang] && map[lang][key]) || (map.en && map.en[key]) || null;
    }

    /**
     * Initialize the GPS tracker and map
     */
    async init(mapElementId) {
        try {
            // Load Leaflet library if not already loaded
            if (!window.L || !window.L.map) {
                await this.loadLeafletLibrary();
            }

            // Check if geolocation is supported
            if (!navigator.geolocation) {
                throw new Error('Geolocation is not supported by this browser');
            }

            // Initialize map
            const mapElement = document.getElementById(mapElementId);
            if (!mapElement) {
                throw new Error(`Map element with id "${mapElementId}" not found`);
            }

            // Get initial position for map center
            this.currentPosition = await this.getPosition();
            this.initializeMap(mapElement);
            this.startTracking();

            return true;
        } catch (error) {
            console.error('GPS initialization error:', error);
            this.showError(error.message);
            return false;
        }
    }

    /**
     * Load Leaflet library (OpenStreetMap)
     */
    loadLeafletLibrary() {
        return new Promise((resolve, reject) => {
            // Check if Leaflet is already loaded
            if (window.L && window.L.map) {
                resolve();
                return;
            }

            // Load Leaflet CSS
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
            document.head.appendChild(css);

            // Load Leaflet JS
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
            script.async = true;
            
            script.onload = () => {
                if (window.L && window.L.map) {
                    resolve();
                } else {
                    setTimeout(resolve, 100);
                }
            };
            
            script.onerror = () => {
                reject(new Error('Failed to load Leaflet library'));
            };

            document.head.appendChild(script);
        });
    }

    /**
     * Get current position using Geolocation API
     */
    getPosition(timeout = 10000) {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    });
                },
                (error) => {
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: timeout,
                    maximumAge: 0
                }
            );
        });
    }

    /**
     * Initialize Leaflet Map (OpenStreetMap)
     */
    initializeMap(mapElement) {
        const defaultCenter = this.currentPosition || { lat: 40.7128, lng: -74.0060 };

        // Create Leaflet map
        this.map = window.L.map(mapElement).setView(
            [defaultCenter.lat, defaultCenter.lng],
            16
        );

        // Add OpenStreetMap tile layer
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            opacity: 0.95
        }).addTo(this.map);

        // Add user position marker
        this.updateUserMarker();

        // Load and display stores
        this.updateStoreMarkers();
    }

    /**
     * Update user's current position marker
     */
    updateUserMarker() {
        if (!this.map || !this.currentPosition) return;

        if (this.userMarker) {
            // Update existing marker position
            this.userMarker.setLatLng([
                this.currentPosition.lat,
                this.currentPosition.lng
            ]);
        } else {
            // Create new user marker with custom styling
            const userIcon = window.L.divIcon({
                className: 'user-location-marker',
                html: '<div style="width: 24px; height: 24px; background: #2563eb; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 0 3px #2563eb; position: relative;"><div style="position: absolute; width: 6px; height: 6px; background: white; border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div></div>',
                iconSize: [24, 24],
                className: 'leaflet-div-icon'
            });

            this.userMarker = window.L.marker(
                [this.currentPosition.lat, this.currentPosition.lng],
                { icon: userIcon, zIndexOffset: 1000 }
            ).addTo(this.map);
            const popupText = this.getTranslation('yourLocation') || 'Your Location';
            this.userMarker.bindPopup(popupText);
        }

        // Center map on user position
        this.map.setView(
            [this.currentPosition.lat, this.currentPosition.lng],
            this.map.getZoom()
        );
    }

    /**
     * Update store markers on the map
     */
    updateStoreMarkers() {
        if (!this.map) return;

        const stores = this.getUserStores();

        // Remove markers for deleted stores
        Object.keys(this.storeMarkers).forEach(storeId => {
            if (!stores.find(s => s.id === storeId)) {
                this.map.removeLayer(this.storeMarkers[storeId].marker);
                if (this.storeMarkers[storeId].popup) {
                    this.map.removeLayer(this.storeMarkers[storeId].popup);
                }
                delete this.storeMarkers[storeId];
            }
        });

        // Add or update store markers
        stores.forEach(store => {
            if (!store.lat || !store.lng) return;

            if (this.storeMarkers[store.id]) {
                // Update existing marker
                this.storeMarkers[store.id].marker.setLatLng([store.lat, store.lng]);
            } else {
                // Create new marker for store
                const storeIcon = window.L.icon({
                    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgZmlsbD0iI2VmNDQ0NCI+PC9jaXJjbGU8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI0IiBmaWxsPSJ3aGl0ZSI+PC9jaXJjbGU+PC9zdmc+',
                    iconSize: [32, 32],
                    iconAnchor: [16, 32],
                    popupAnchor: [0, -32]
                });

                const marker = window.L.marker(
                    [store.lat, store.lng],
                    { icon: storeIcon, zIndexOffset: 100 }
                ).addTo(this.map);

                // Create popup content
                const popupContent = this.getStoreInfoContent(store);
                marker.bindPopup(popupContent, { maxWidth: 250 });

                this.storeMarkers[store.id] = {
                    marker,
                    store
                };
            }
        });
    }

    /**
     * Get HTML content for store info window
     */
    getStoreInfoContent(store) {
        const distance = this.currentPosition && store.lat && store.lng
            ? this.calculateDistance(
                this.currentPosition.lat,
                this.currentPosition.lng,
                store.lat,
                store.lng
            )
            : null;

        const distanceStr = distance ? ` • ${this.formatDistance(distance)}` : '';
        const lang = localStorage.getItem('eps_language') || 'en';
        const ownerLabel = lang === 'bg' ? 'Собственик' : 'Owner';
        
        return `
            <div style="padding: 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">${store.name}</h3>
                <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">${ownerLabel}: ${store.owner || 'N/A'}</p>
                <p style="margin: 0; font-size: 12px; color: #2563eb; font-weight: 500;">${distanceStr.slice(3)}</p>
            </div>
        `;
    }

    /**
     * Start GPS tracking (watch position changes)
     */
    startTracking() {
        if (this.isTracking) return;

        this.isTracking = true;
        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                this.currentPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };

                this.updateUserMarker();
                this.checkStoreProximity();
                this.updateAllStoreDistances();
            },
            (error) => {
                console.error('GPS tracking error:', error);
                this.showError('GPS error: ' + error.message);
            },
            {
                enableHighAccuracy: true,
                timeout: 30000,
                maximumAge: 0
            }
        );

        document.dispatchEvent(new CustomEvent('gpsTrackerStarted'));
    }

    /**
     * Stop GPS tracking
     */
    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
            this.isTracking = false;
            document.dispatchEvent(new CustomEvent('gpsTrackerStopped'));
        }
    }

    /**
     * Check proximity to stores and trigger alerts
     */
    checkStoreProximity() {
        if (!this.currentPosition) return;

        const stores = this.getUserStores();

        stores.forEach(store => {
            if (!store.lat || !store.lng) return;

            const distance = this.calculateDistance(
                this.currentPosition.lat,
                this.currentPosition.lng,
                store.lat,
                store.lng
            );

            const isNearby = distance <= this.options.proximityRadius;
            const hasAlerted = this.proximityAlerts[store.id];

            if (isNearby && !hasAlerted) {
                // First time getting close to this store
                this.triggerProximityAlert(store);
                this.proximityAlerts[store.id] = true;
            } else if (!isNearby && hasAlerted) {
                // Left the proximity zone
                delete this.proximityAlerts[store.id];
            }
        });
    }

    /**
     * Trigger proximity alert and open delivery popup
     */
    triggerProximityAlert(store) {
        // Dispatch custom event with store data
        const event = new CustomEvent('storeProximityAlert', {
            detail: { store }
        });
        document.dispatchEvent(event);

        // Show visual notification
        this.showProximityNotification(store);

        // Auto-open the store selection popup for delivery
        this.autoOpenStorePopup(store);
    }

    /**
     * Show proximity notification
     */
    showProximityNotification(store) {
        const arrivedText = this.getTranslation('arrived') || 'You\'ve arrived at';

        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 14px;
            z-index: 1001;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
            animation: slideIn 0.3s ease-out;
            max-width: 300px;
        `;
        notification.innerHTML = `
            <div>📍 ${arrivedText}</div>
            <div style="font-size: 16px; font-weight: 700; margin-top: 4px;">${store.name}</div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(notification);

        // Auto-remove after 4 seconds
        setTimeout(() => notification.remove(), 4000);
    }

    /**
     * Auto-open store popup for delivery
     */
    autoOpenStorePopup(store) {
        // Find the "Make a delivery" button and trigger it
        const makeDeliveryBtn = document.getElementById('makeDeliveryBtn');
        const storePopup = document.getElementById('storePopup');

        if (!makeDeliveryBtn || !storePopup) return;

        // Dispatch event for the app to handle
        const event = new CustomEvent('autoStartDelivery', {
            detail: { store }
        });
        document.dispatchEvent(event);
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Earth's radius in meters
        const rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad;
        const dLng = (lng2 - lng1) * rad;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Format distance for display
     */
    formatDistance(meters) {
        if (meters < 1000) {
            return Math.round(meters) + ' m';
        }
        return (meters / 1000).toFixed(1) + ' km';
    }

    /**
     * Update all store distances on the UI
     */
    updateAllStoreDistances() {
        Object.values(this.storeMarkers).forEach(({ marker, store }) => {
            if (!this.currentPosition || !store.lat || !store.lng) return;

            const distance = this.calculateDistance(
                this.currentPosition.lat,
                this.currentPosition.lng,
                store.lat,
                store.lng
            );

            // Update the title/hover text
            marker.setTitle(`${store.name} • ${this.formatDistance(distance)}`);
        });

        // Update distance list if it exists
        this.updateDistanceListUI();
    }

    /**
     * Update distance list in the UI
     */
    updateDistanceListUI() {
        const distanceList = document.getElementById('storeDistanceList');
        if (!distanceList) return;

        const stores = this.getUserStores().filter(s => s.lat && s.lng);

        const lang = localStorage.getItem('eps_language') || 'en';
        const noStoresText = lang === 'bg' ? 'Няма магазини с GPS координати' : 'No stores with GPS coordinates';
        const nearbyText = lang === 'bg' ? 'БЛИЗО' : 'NEARBY';
        const ownerText = lang === 'bg' ? 'Собственик' : 'Owner';

        if (stores.length === 0) {
            distanceList.innerHTML = `<p style="text-align: center; color: #999; margin: 20px 0;">${noStoresText}</p>`;
            return;
        }

        // Calculate distances
        const storesWithDistance = stores.map(store => {
            const distance = this.calculateDistance(
                this.currentPosition.lat,
                this.currentPosition.lng,
                store.lat,
                store.lng
            );
            return { ...store, distance };
        }).sort((a, b) => a.distance - b.distance);

        distanceList.innerHTML = storesWithDistance.map(store => {
            const isNearby = store.distance <= this.options.proximityRadius;
            const bgColor = isNearby ? '#dcfce7' : '#f3f4f6';
            const borderColor = isNearby ? '#10b981' : '#e5e7eb';
            const textColor = isNearby ? '#065f46' : '#1f2937';

            return `
                <div style="
                    background: ${bgColor};
                    border: 1px solid ${borderColor};
                    border-radius: 8px;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <div>
                        <div style="font-weight: 600; color: ${textColor}; font-size: 14px;">${store.name}</div>
                        <div style="color: #6b7280; font-size: 12px; margin-top: 2px;">${ownerText}: ${store.owner || 'N/A'}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: 700; color: #2563eb; font-size: 14px;">${this.formatDistance(store.distance)}</div>
                        ${isNearby ? `<div style="color: #10b981; font-size: 11px; font-weight: 600;">${nearbyText}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Get user stores from localStorage
     */
    getUserStores() {
        const userId = localStorage.getItem('eps_user_id') || 'anonymous';
        const data = localStorage.getItem('eps_stores_' + userId);
        return data ? JSON.parse(data) : [];
    }

    /**
     * Show error message to user
     */
    showError(message) {
        const error = document.createElement('div');
        error.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 14px;
            z-index: 1001;
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
            max-width: 300px;
        `;
        
        const lang = localStorage.getItem('eps_language') || 'en';
        const warningIcon = '⚠';
        
        error.textContent = warningIcon + ' ' + message;
        document.body.appendChild(error);

        setTimeout(() => error.remove(), 5000);
    }

    /**
     * Reset proximity alerts (useful when starting a new session)
     */
    resetProximityAlerts() {
        this.proximityAlerts = {};
    }

    /**
     * Get tracking status
     */
    getStatus() {
        return {
            isTracking: this.isTracking,
            currentPosition: this.currentPosition,
            proximityRadius: this.options.proximityRadius,
            nearbyStores: Object.keys(this.proximityAlerts)
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GPSTracker;
}
