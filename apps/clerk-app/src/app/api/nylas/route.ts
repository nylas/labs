import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const { userId } = await auth()

  if (!userId) {
    return NextResponse.json({ message: 'User not found' })
  }

  try {
  // Get the OAuth access token for the user
  const provider = 'custom_nylas'

  const client = await clerkClient()

  const clerkResponse = await client.users.getUserOauthAccessToken(userId, provider)

  console.debug(clerkResponse)

  if (!clerkResponse.data) {
    return NextResponse.json({ message: 'Access token not found' }, { status: 401 })
  }

  // enssure we have some data
  if (!clerkResponse.data || clerkResponse.data.length === 0) {
    return NextResponse.json({ message: 'Access token not found' }, { status: 401 })
  }

  const accessToken = clerkResponse.data[0].token || ''

  if (!accessToken) {
    return NextResponse.json({ message: 'Access token not found' }, { status: 401 })
  }

  // Fetch the user data from the Notion API
  // This endpoint fetches a list of users
  // https://developers.notion.com/reference/get-users
  const nylasUrl = 'https://api.us.nylas.com/v3/grants/me/calendars'

  const nylasResponse = await fetch(nylasUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  // Handle the response from the Notion API
  const nylasData = await nylasResponse.json()

    return NextResponse.json({ nylasData })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ message: 'Error fetching Nylas data' }, { status: 500 })
  }
}