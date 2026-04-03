import { fetch } from 'undici'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'

const logger = createLogger()

export async function fetchForecast() {
  const forecastApiUrl = config.get('metOfficeForecast.forecastApiUrl')
  const url = `${forecastApiUrl}/forecast`

  logger.info(
    `[Forecast] Fetching MetOffice forecast data ${JSON.stringify({ url })}`
  )

  const response = await fetch(url, {
    method: 'GET'
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Forecast API responded with ${response.status}: ${errorText}`
    )
  }

  const body = await response.json()
  logger.info(
    `[Forecast] Forecast data received ${JSON.stringify({ totalForecasts: body.forecasts?.length ?? 0 })}`
  )
  return body
}
