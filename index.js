const api_url = "https://api.spotify.com/v1"
const auth_url = "https://accounts.spotify.com/api/token"

const apiRequest = (method, url, auth, params, callback) => {

	if (!url.includes('https://')) url = api_url+url

	let requestOptions = { url: url, method: method, json: true}

	if (auth) requestOptions.auth = { bearer: settings.spotify.access_token }
	
	if (method === 'GET') {
		let urlParameters = Object.keys(params).map((i) => typeof params[i] !== 'object' && !getParameterByName(i, requestOptions.url) ? i+'='+params[i]+'&' : '' ).join('') // transforms to url format everything except objects
		requestOptions.url += (requestOptions.url.includes('?') ? '&' : '?') + urlParameters
	} else {
		requestOptions.json = params
	}
	
	request(requestOptions, (err, result, body) => {
		if (body && body.error) callback(body.error, body)
		else callback(err, body)
	})

}

const auth = (code, callback) => {

	request.post({
		url: auth_url, 
		json: true, 
		form: {
			client_id: settings.clientIds.spotify.client_id,
			client_secret: settings.clientIds.spotify.client_secret,
			grant_type: 'authorization_code',
			redirect_uri: 'http://localhost',
			code: code
		} 
	}, (err, res, body) => {
		callback(err, body)
	})

}

const refreshToken = (callback) => {

	request.post({
		url: auth_url, 
		json: true, 
		form: {
			client_id: settings.clientIds.spotify.client_id,
			client_secret: settings.clientIds.spotify.client_secret,
			grant_type: 'refresh_token',
			redirect_uri: 'http://localhost',
			refresh_token: settings.spotify.refresh_token
		} 
	}, (err, res, body) => {
		if (err) return callback(err)

		settings.spotify.access_token = body.access_token
		callback()
	})

}

const convertTrack = (rawTrack) => {
	return {
		service: 'spotify',
		title: rawTrack.name,
		share_url: rawTrack.external_urls.spotify,
		album: {
			name: rawTrack.album ? rawTrack.album.name : '',
			id: rawTrack.album ? rawTrack.album.id : ''
		},
		trackNumber: rawTrack.track_number,
		artist: {
			name: rawTrack.artists[0].name,
			id: rawTrack.artists[0].id
		},
		id: rawTrack.id,
		duration: rawTrack.duration_ms,
		artwork: rawTrack.album && rawTrack.album.images[2] ? rawTrack.album.images[2].url : ''
	}

}

/**
 * Spotify API Abstraction
 */
class Spotify {

	/**
	 * Fetches data
	 *
	 * @returns {Promise}
	 */
	static fetchData (callback) {
		
		if (!settings.spotify.refresh_token) {
			settings.spotify.error = true
			return callback([null, true])
		}

		refreshToken(error => {

			if (error) {
				settings.spotify.error = true
				return callback([error, true])
			}

			apiRequest('GET', '/me/playlists', true, {limit: 50}, (err, result) => {

				if (err) return callback([err])

				for (let i of result.items) {

					!function outer(i) {

						apiRequest('GET', i.tracks.href.split('/v1')[1], true, {limit: 100}, (err, result) => {
							
							if (err) return callback([err])

							let tempTracks = []

							function moreTracks(url) {
								apiRequest('GET', url.split('/v1')[1], true, {limit: 100}, (err, result) => {
									if (err) return callback([err])

									for (let t of result.items)
										if (t.track && t.track.id) tempTracks.push(convertTrack(t.track))

									if (result.next) moreTracks(result.next)
									else over()

								})
							}


							if (result) {
								for (let t of result.items)
									if (t.track && t.track.id) tempTracks.push(convertTrack(t.track))

								if (result.next) moreTracks(result.next)
								else over()
							}

							function over() {
								Data.addPlaylist({
									service: 'spotify',
									editable: (i.owner.id === settings.spotify.userId),
									title: i.name,
									id: i.id,
									author: {
										id: i.owner.id,
										name: i.owner.display_name
									},
									icon: (i.name == 'Discover Weekly' ? 'compass' : null),
									artwork: (i.images[0] ? i.images[0].url : ''),
									tracks: tempTracks,
									canBeDeleted: true
								})
							}

						})

					}(i)
				}

				let tempMytracks = []

				const addToSpotifyPlaylistFavs = (url) => {

					apiRequest('GET', url, true, {limit: 50}, (err, result) => {

						if (err) return callback([err])

						for (let i of result.items)
							if (i.track && i.track.id) tempMytracks.push(convertTrack(i.track))

						if (result.next) {
							addToSpotifyPlaylistFavs(result.next.split('/v1')[1])
						} else {

							Data.addPlaylist({
								service: 'spotify',
								title: 'My tracks',
								artwork: '',
								icon: 'spotify',
								id: 'favs',
								tracks: tempMytracks
							})

							callback()
						}

					})
				}

				addToSpotifyPlaylistFavs('/me/tracks')

			})

		})
	}

	/**
	 * Called when user wants to activate the service
	 *
	 * @param callback {Function} Callback function
	 */
	static login (callback) {

		const oauthUrl = `https://accounts.spotify.com/authorize?client_id=${settings.clientIds.spotify.client_id}&redirect_uri=http://localhost&response_type=code&scope=user-library-read%20user-top-read%20user-read-private%20user-library-modify%20playlist-read-private%20playlist-modify-public%20playlist-modify-private%20playlist-read-collaborative`
		oauthLogin(oauthUrl, (code) => {

			if (!code) return callback('stopped')

			auth( code, (err, data) => {

				if (err) return callback(err)

				settings.spotify.access_token = data.access_token
				settings.spotify.refresh_token = data.refresh_token

				apiRequest('GET', `/me`, true, {}, (err, result) => {

					if (err) return callback(err)
					settings.spotify.userId = result.id
					callback()

				})
			
			})

		})

	}


	/**
	* Create a Playlist
	*
	* @param name {String} The name of the playlist to be created
	*/
	static createPlaylist (name, callback) {
		
		refreshToken(error => {
			apiRequest('POST', `/users/${settings.spotify.userId}/playlists`, true, {name: name}, (err, playlist) => {

				if (err || error) return callback(err || error)

				callback(null, {
					service: 'spotify',
					editable: true,
					canBeDeleted: true,
					author: {
						name: playlist.owner.display_name,
						id: playlist.owner.id
					},
					title: playlist.name,
					id: playlist.id,
					artwork: (playlist.images[0] ? playlist.images[0].url : ''),
					tracks: []
				})

			})
		})

	}

	/**
	* Delete a Playlist (unfollowing it is Spotify's way)
	*
	* @param playlist {Object} The object of the playlist to be deleted
	*/
	static deletePlaylist (playlist, callback) {
		
		refreshToken(error => {

			apiRequest('DELETE', `/users/${playlist.author.id}/playlists/${playlist.id}/followers`, true, {}, (err, result) => {
			
				callback(err || error)

			})
		})

	}


	/**
	* Add tracks to a playlist
	*
	* @param tracks {Array} The tracks objects
	* @param playlistId {string} The playlist ID
	*/
	static addToPlaylist (tracks, playlistId, callback) {
		let uris = []

		for (let track of tracks)
			uris.push(`spotify:track:${track.id}`)

		refreshToken(error => {

			apiRequest('POST', `/users/${settings.spotify.userId}/playlists/${playlistId}/tracks`, true, {uris: uris}, (err, result) => {

				callback(error || err)

			})
		})

	}



	/**
	* Remove tracks from a playlist
	*
	* @param tracks {Array} The tracks objects
	* @param playlistId {string} The playlist ID
	*/
	static removeFromPlaylist (tracks, playlistId, callback) {
		let uris = []

		for (let track of tracks)
			uris.push({uri: `spotify:track:${track.id}`})

		refreshToken(error => {

			apiRequest('DELETE', `/users/${settings.spotify.userId}/playlists/${playlistId}/tracks`, true, {tracks: uris}, (err, result) => {

				callback(error || err)

			})
		})

	}


	/**
	 * Like a song 
	 *
	 * @param track {Object} The track object
	 */
	static like (track, callback) {
		refreshToken(error => {
			apiRequest('PUT', `/me/tracks`, true, {ids: [track.id]}, (err, result) => {
				callback(error || err)
			})
		})
	}

	/**
	 * Unlike a song
	 *
	 * @param track {Object} The track object
	 */
	static unlike (track, callback) {
		refreshToken(error => {
			apiRequest('DELETE', `/me/tracks`, true, {ids: [track.id]}, (err, result) => {
				callback(error || err)
			})
		})
	}

	/**
	 * View the artist
	 *
	 * @param track {Object} The track object
	 */
	static viewArtist (tracks) {
		let track = tracks[0]

		specialView('spotify', 'loading', 'artist', track.artist.name)

		refreshToken(error => {
			apiRequest('GET', `/artists/${track.artist.id}`, true, {}, (err, result) => {
				if (err) return console.error(err)

				let image = result.images[0].url

				apiRequest('GET', `/artists/${track.artist.id}/top-tracks`, true, {country: 'US'}, (err, result) => {
					if (err) return console.error(err)

					let tracks = []

					for (let tr of result.tracks)
						if (tr) tracks.push(convertTrack(tr))

					specialView('spotify', tracks, 'artist', track.artist.name, image)
				})
			})
		})
	}

	/**
	 * View an album
	 *
	 * @param track {Object} The track object
	 */
	static viewAlbum (tracks) {
		let track = tracks[0]

		specialView('spotify', 'loading', 'album', track.album.name, track.artwork)
		
		refreshToken(error => {

			apiRequest('GET', `/albums/${track.album.id}/tracks`, true, {}, (err, result) => {
				if (err) return console.error(err)

				let tracks = []

				for (let tr of result.items)
					if (tr) tracks.push(convertTrack(tr))

				specialView('spotify', tracks, 'album', track.album.name, track.artwork)

			})
		})
	}

	/**
	* Search
	* @param query {String}: the query of the search
	* @param callback
	*/
	static searchTracks (query, callback) {

		refreshToken(error => {

			apiRequest('GET', `/search`, true, {type: 'track', q: encodeURI(query)}, (err, result) => {

				if (err) return console.error(err)
				let tracks = []

				for (let tr of result.tracks.items)
					if (tr) tracks.push(convertTrack(tr))

				callback(tracks, query)

			})
		})
	}

	/*
	* Returns the settings items of this plugin
	*
	*/
	static settingsItems () {
		return [
			{
				type: 'activate',
				id: 'active'
			}
		]
	}

	/*
	* Returns the context menu items of this plugin
	*
	* @param tracks {Array of Objects} The selected tracks object
	*/
	static contextmenuItems (tracks) {
		return [
			{
				label: 'View artist',
				click: () => Spotify.viewArtist(tracks)
			},

			{
				label: 'View album',
				click: () => Spotify.viewAlbum(tracks)
			}
		]
	}

}

/** Static Properties **/
Spotify.favsPlaylistId = "favs"
Spotify.scrobbling = true
Spotify.settings = {
	active: false
}

module.exports = Spotify