const dns = require("dns"),
	  fs = require("fs"),
	  path = require("path"),
	  config = require(__dirname+'/config'),
	  logger = require(__dirname+'/logger'),
	  webirc_data_path = path.resolve(__dirname+'/../webirc.data.json');

let webirc_data = {};
let timeouts = {};

function writeToFile() {
	fs.writeFile(webirc_data_path, JSON.stringify(webirc_data, null, '\t'), function (err) {if (err) throw err;});
}

function timeoutRefresh(address, seconds) {
	if(timeouts[address])
		clearTimeout(timeouts[address]);

	timeouts[address] = setTimeout(()=>{resolveAddress(address)}, seconds*1000);
}

function resolveAddress(address, force) {
	logger.debugLog("** WEBIRC ** Attempting to update IP for "+address);
	let obj = webirc_data[address];
	
	if(!obj) return;

	if((Date.now() - obj.last_update)/1000 < config.webirc.resolveInterval && !force) {
		let nextTime = (config.webirc.resolveInterval - (Date.now() - obj.last_update)/1000);
		
		logger.debugLog("** WEBIRC ** "+address+" IP is "+obj.cached_ip+", refresh in "+nextTime+" seconds");

		return timeoutRefresh(address, nextTime);
	}

	new Promise((resolve, reject) => {
		dns.resolve(address, (err, data) => {
			if(err!=null) return reject(err);
			let ip = data.length > 0 ? data[0] : null;
			if(ip) {
				resolve(ip);
			} else {
				reject(new Error("no ips"));
			}
		});
	}).then((data) => {
		logger.debugLog("** WEBIRC ** Updated DNS for "+address+"; IP is now "+data);

		webirc_data[address].last_update = Date.now();
		webirc_data[address].cached_ip = data;
		
		writeToFile();
		timeoutRefresh(address, config.webirc.resolveInterval);
	}, (err) => {
		logger.debugLog("** WEBIRC ** Failed to updated DNS for "+address+"; IP is still "+webirc_data[address].cached_ip);

		timeoutRefresh(address, (config.webirc.resolveInterval+60));
	});
}

function reload(force) {
	if(!config.webirc.enabled) return;

	try {
		fs.accessSync(webirc_data_path, fs.F_OK);

		webirc_data = require(webirc_data_path);

		if (require.cache && require.cache[webirc_data_path]) {
			delete require.cache[webirc_data_path];
		}
	} catch(e) {
		writeToFile();
	}

	for(let adr in webirc_data) {
		resolveAddress(adr, force);
	}
}

function get_password(server_ip) {
	let ip = null;
	for(let a in webirc_data) {
		if(webirc_data[a].cached_ip == server_ip)
			ip = webirc_data[a];
	}

	return ip;
}

class WebIRCAuthenticator {
	constructor(userInfo) {
		this.userInfo = userInfo;
	}

	authenticate(connection) {
		let serverpass = get_password(connection.config.address);
		if(serverpass)
			connection.socket.write('WEBIRC '+serverpass.password+' '+connection.config.username+
				' '+this.userInfo.hostname+' '+this.userInfo.ipaddr+'\r\n');
	}
}

module.exports = {
	reload: reload,
	authenticator: WebIRCAuthenticator,
	get_password: get_password,
	writeToFile: writeToFile
};

process.on('SIGUSR1', () => {
	logger.log("\n!!! Received SIGUSR1; Reloading webirc data.. !!!\n");
	reload(true);
});

reload(false);
