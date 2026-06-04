import { lastfmCall } from '@/services/lastfm.service'
import type {
  LastfmSimilarTracksResponse, LastfmSimilarArtistsResponse,
  LastfmArtistTopTracksResponse, LastfmTrackTopTagsResponse,
  LastfmTagTopTracksResponse
} from '@/types/api.types'

export function getSimilarTracks(
  artist: string, title: string, limit = 15
): Promise<LastfmSimilarTracksResponse> {
  return lastfmCall<LastfmSimilarTracksResponse>('track.getSimilar', {
    artist, track: title, limit, autocorrect: 1
  })
}

export function getSimilarArtists(
  artist: string, limit = 4
): Promise<LastfmSimilarArtistsResponse> {
  return lastfmCall<LastfmSimilarArtistsResponse>('artist.getSimilar', {
    artist, limit, autocorrect: 1
  })
}

export function getArtistTopTracks(
  artist: string, limit = 4
): Promise<LastfmArtistTopTracksResponse> {
  return lastfmCall<LastfmArtistTopTracksResponse>('artist.getTopTracks', {
    artist, limit, autocorrect: 1
  })
}

export function getTrackTopTags(
  artist: string, title: string
): Promise<LastfmTrackTopTagsResponse> {
  return lastfmCall<LastfmTrackTopTagsResponse>('track.getTopTags', {
    artist, track: title, autocorrect: 1
  })
}

export function getTagTopTracks(
  tag: string, limit = 10
): Promise<LastfmTagTopTracksResponse> {
  return lastfmCall<LastfmTagTopTracksResponse>('tag.getTopTracks', { tag, limit })
}
