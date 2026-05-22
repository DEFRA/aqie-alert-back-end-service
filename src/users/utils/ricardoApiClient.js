import { fetch, Agent, ProxyAgent } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { provideProxy } from '../../common/helpers/proxy/proxy.js'

const logger = createLogger()
const isProduction = process.env.NODE_ENV === 'production'
const RICARDO_REQUEST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Mock alert data — used when RICARDO_API_USE_MOCK=true.
// Only fetchAlerts is mocked. getAccessToken and fetchSiteMetaData always call
// the real Ricardo API so the site-region cache is populated with live data.
// Note: query params (start-date / end-date) are ignored — all 18 alerts are
// returned every call. For date-filter behaviour, run against the real API.
// ---------------------------------------------------------------------------
// const MOCK_ALERT_DATE_ACTIVE = new Date(
//   Date.now() - 2 * 60 * 60 * 1000
// ).toISOString()
const MOCK_ALERT_DATE_PAST = new Date(
  Date.now() - 48 * 60 * 60 * 1000
).toISOString()

const MOCK_ALERTS_RESPONSE = {
  '@context': '/api/contexts/AQSRAlert',
  '@id': '/api/aqsr_alerts',
  '@type': 'Collection',
  totalItems: 21,
   "member": [
        {
            "@id": "/api/a_q_s_r_alerts/1187",
            "@type": "AQSRAlert",
            "id": 1187,
            "samplingPointId": 290,
            "siteId": "UKA00339",
            "region": "North West & Merseyside",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 190,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Wed 13/08/2025 at 5pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Salford Eccles (190 &micro;g/m<sup>3</sup>) on 13/08/2025 17:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-22T13:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1186",
            "@type": "AQSRAlert",
            "id": 1186,
            "samplingPointId": 71,
            "siteId": "UKA00170",
            "region": "North West & Merseyside",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 182,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Wed 13/08/2025 at 4pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Glazebury (182 &micro;g/m<sup>3</sup>) on 13/08/2025 16:00 BST</li>\n\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-22T10:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1186",
            "@type": "AQSRAlert",
            "id": 1186,
            "samplingPointId": 290,
            "siteId": "UKA00339",
            "region": "North West & Merseyside",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 187,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Wed 13/08/2025 at 4pm</h3><ul>\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Salford Eccles (187 &micro;g/m<sup>3</sup>) on 13/08/2025 16:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-22T12:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1177",
            "@type": "AQSRAlert",
            "id": 1177,
            "samplingPointId": 78072,
            "siteId": "UKA00650",
            "region": "South West",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 184,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Tue 12/08/2025 at 6pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Swindon Walcot (184 &micro;g/m<sup>3</sup>) on 12/08/2025 18:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-22T09:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1156",
            "@type": "AQSRAlert",
            "id": 1156,
            "samplingPointId": 238,
            "siteId": "UKA00265",
            "region": "West Midlands",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": false,
            "concentration": 184,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Fri 11/07/2025 at 7pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Leamington Spa (184 &micro;g/m<sup>3</sup>) on 11/07/2025 19:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-22T03:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1154",
            "@type": "AQSRAlert",
            "id": 1154,
            "samplingPointId": 79102,
            "siteId": "UKA01062",
            "region": "West Midlands",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": false,
            "concentration": 198,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Fri 11/07/2025 at 5pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Birmingham Hall Green (198 &micro;g/m<sup>3</sup>) on 11/07/2025 17:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-07-11T17:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1153",
            "@type": "AQSRAlert",
            "id": 1153,
            "samplingPointId": 79102,
            "siteId": "UKA01062",
            "region": "West Midlands",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 186,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Fri 11/07/2025 at 4pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Birmingham Hall Green (186 &micro;g/m<sup>3</sup>) on 11/07/2025 16:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-07-11T16:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1142",
            "@type": "AQSRAlert",
            "id": 1142,
            "samplingPointId": 25123,
            "siteId": "UKA00012",
            "region": "Eastern",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 194,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Tue 01/07/2025 at 5pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Sibton (194 &micro;g/m<sup>3</sup>) on 01/07/2025 17:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-21T04:11:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1114",
            "@type": "AQSRAlert",
            "id": 1114,
            "samplingPointId": 61714,
            "siteId": "UKA00472",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 193,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Fri 20/06/2025 at 4pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Harlington (193 &micro;g/m<sup>3</sup>) on 19/06/2025 18:00 BST</li>\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Harlington (186 &micro;g/m<sup>3</sup>) on 19/06/2025 19:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-20T16:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1114",
            "@type": "AQSRAlert",
            "id": 1114,
            "samplingPointId": 61714,
            "siteId": "UKA00472",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 186,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Fri 20/06/2025 at 4pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Harlington (193 &micro;g/m<sup>3</sup>) on 19/06/2025 18:00 BST</li>\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Harlington (186 &micro;g/m<sup>3</sup>) on 19/06/2025 19:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-20T16:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1109",
            "@type": "AQSRAlert",
            "id": 1109,
            "samplingPointId": 61501,
            "siteId": "UKA00462",
            "region": "South East",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": false,
            "concentration": 182,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 7pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at Reading New Town (182 &micro;g/m<sup>3</sup>) on 19/06/2025 19:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2026-05-22T08:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1108",
            "@type": "AQSRAlert",
            "id": 1108,
            "samplingPointId": 79000,
            "siteId": "UKA00656",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 200,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 6pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Honor Oak Park (200 &micro;g/m<sup>3</sup>) on 19/06/2025 18:00 BST</li>\n\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T18:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1108",
            "@type": "AQSRAlert",
            "id": 1108,
            "samplingPointId": 203,
            "siteId": "UKA00253",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 182,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 6pm</h3><ul>\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London N. Kensington (182 &micro;g/m<sup>3</sup>) on 19/06/2025 18:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T18:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1107",
            "@type": "AQSRAlert",
            "id": 1107,
            "samplingPointId": 95,
            "siteId": "UKA00211",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 183,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 5pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Bloomsbury (183 &micro;g/m<sup>3</sup>) on 19/06/2025 17:00 BST</li>\n\n\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T17:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1107",
            "@type": "AQSRAlert",
            "id": 1107,
            "samplingPointId": 79000,
            "siteId": "UKA00656",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 181,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 5pm</h3><ul>\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Honor Oak Park (181 &micro;g/m<sup>3</sup>) on 19/06/2025 17:00 BST</li>\n\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T17:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1107",
            "@type": "AQSRAlert",
            "id": 1107,
            "samplingPointId": 203,
            "siteId": "UKA00253",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 192,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 5pm</h3><ul>\n\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London N. Kensington (192 &micro;g/m<sup>3</sup>) on 19/06/2025 17:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T17:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1106",
            "@type": "AQSRAlert",
            "id": 1106,
            "samplingPointId": 95,
            "siteId": "UKA00211",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 181,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 4pm</h3><ul><li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London Bloomsbury (181 &micro;g/m<sup>3</sup>) on 19/06/2025 16:00 BST</li>\n\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T16:00:00+01:00"
        },
        {
            "@id": "/api/a_q_s_r_alerts/1106",
            "@type": "AQSRAlert",
            "id": 1106,
            "samplingPointId": 203,
            "siteId": "UKA00253",
            "region": "Greater London",
            "pollutant": "O<sub>3</sub> (O3)",
            "informationThreshold": "EU ozone public information threshold of 180&micro;g/m<sup>3</sup>",
            "informationLevel": true,
            "alertThreshold": "Ozone Alert 240&micro;g/m<sup>3</sup>",
            "alertLevel": true,
            "concentration": 188,
            "duration": null,
            "alertText": "<?xml encoding=\"utf-8\" ?><h3>Pollution Alert Warning Thu 19/06/2025 at 4pm</h3><ul>\n<li> Ozone Public information threshold 180 &micro;g/m<sup>3</sup> breached at London N. Kensington (188 &micro;g/m<sup>3</sup>) on 19/06/2025 16:00 BST</li>\n\n</ul><p>Please see ....</p><ul>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/period_plots?POL=O3&amp;days=7\">O3 data plots</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/currentlevels?period=24\">Maximum 8hour running mean Ozone in the last 24 hours</a></li>\n<li><a href=\"http://uk-air.defra.gov.uk/latest/\">Latest measured index levels</a> and associated <a href=\"http://uk-air.defra.gov.uk/air-pollution/daqi\">health advice.</a></li></ul><p><b> NB - These data are provisional and are subject to change</b></p>\n",
            "coverage": "N/A",
            "validationStatus": 2,
            "date": "2025-06-19T16:00:00+01:00"
        }
    ] 
}

/**
 * Builds an undici dispatcher for Ricardo API calls.
 *
 * The Ricardo staging server uses an untrusted TLS certificate, so
 * rejectUnauthorized is disabled for non-production environments.
 * In production, standard SSL verification applies.
 * Proxy configuration from provideProxy() is respected in all environments.
 */
function getRicardoDispatcher() {
  const proxy = provideProxy()

  if (!isProduction) {
    const connectOptions = { rejectUnauthorized: false }
    if (proxy) {
      return new ProxyAgent({
        uri: proxy.url.toString(),
        connect: connectOptions,
        keepAliveTimeout: 10,
        keepAliveMaxTimeout: 10
      })
    }
    return new Agent({ connect: connectOptions })
  }

  return proxy ? proxy.proxyAgent : undefined
}

export async function getAccessToken() {
  const loginUrl = config.get('ricardoApi.loginUrl')
  const email = config.get('ricardoApi.email')
  const password = config.get('ricardoApi.password')

  logger.info('Requesting access token from Ricardo API')

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(loginUrl, fetchOptions)

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(
      `Ricardo API login failed ${JSON.stringify({ status: response.status, errorText })}`
    )
    const err = new Error(
      `Ricardo API login failed: ${response.status} - ${errorText}`
    )
    err.status = response.status
    err.body = errorText
    throw err
  }

  const data = await response.json()
  const token = data.token
  if (!token) {
    logger.error(
      `Ricardo API login succeeded but no token found in response. Available keys: ${Object.keys(data).join(', ')}`
    )
    throw new Error(
      'Ricardo API login succeeded but no token field found in response'
    )
  }

  logger.info('Ricardo API access token obtained successfully')
  return token
}

async function fetchAlertsFromRicardo(options = {}) {
  const token = await getAccessToken()
  const baseAlertsUrl = config.get('ricardoApi.alertsUrl')
  const { startDate, endDate } = options
  const alertsUrl =
    startDate && endDate
      ? `${baseAlertsUrl}?start-date=${startDate}&end-date=${endDate}`
      : baseAlertsUrl

  logger.info(
    `Fetching AQSR alerts from Ricardo API ${JSON.stringify({ url: alertsUrl })}`
  )

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ld+json',
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(alertsUrl, fetchOptions)

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(
      `Ricardo API alerts fetch failed ${JSON.stringify({ status: response.status, errorText })}`
    )
    const err = new Error(
      `Ricardo API alerts fetch failed: ${response.status} - ${errorText}`
    )
    err.status = response.status
    err.body = errorText
    throw err
  }

  const data = await response.json()
  logger.info(`Fetched ${data.totalItems} alerts from Ricardo API`)
  return data
}

// When useMock=true, the real Ricardo API is still called so live traffic
// is generated against it (for perf measurement); the mock response is then
// returned to the caller so downstream logic has deterministic data to work
// with. When useMock=false, the real Ricardo response is returned directly.
export async function fetchAlerts(options = {}) {
  if (config.get('ricardoApi.useMock')) {
    try {
      const realData = await fetchAlertsFromRicardo(options)
      logger.info(
        `[PERF-TEST] Real Ricardo call succeeded with ${realData.totalItems} items; returning mock response instead`
      )
    } catch (err) {
      logger.warn(
        `[PERF-TEST] Real Ricardo call failed during mock mode (continuing with mock) ${JSON.stringify({ error: err.message })}`
      )
    }
    logger.info(
      `[MOCK] Returning mock Ricardo alerts response (${MOCK_ALERTS_RESPONSE.totalItems} items)`
    )
    return MOCK_ALERTS_RESPONSE
  }

  return fetchAlertsFromRicardo(options)
}

export async function fetchSiteMetaData() {
  const token = await getAccessToken()
  const siteMetaDataUrl = config.get('ricardoApi.siteMetaDataUrl')

  logger.info(
    `Fetching site metadata from Ricardo API ${JSON.stringify({ url: siteMetaDataUrl })}`
  )

  const dispatcher = getRicardoDispatcher()
  const fetchOptions = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ld+json',
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(RICARDO_REQUEST_TIMEOUT_MS)
  }
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher
  }

  const response = await fetch(siteMetaDataUrl, fetchOptions)

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(
      `Ricardo API site metadata fetch failed ${JSON.stringify({ status: response.status, errorText })}`
    )
    const err = new Error(
      `Ricardo API site metadata fetch failed: ${response.status} - ${errorText}`
    )
    err.status = response.status
    err.body = errorText
    throw err
  }

  const data = await response.json()
  logger.info(`Fetched ${data.totalItems} sites from Ricardo API`)
  return data
}
