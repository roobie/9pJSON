'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Dirent = undefined;

var _assert = require('assert');

var _assert2 = _interopRequireDefault(_assert);

require('object.assign');

var _user = require('./user');

var _util = require('../util');

var _qid = require('./qid');

var _qid2 = _interopRequireDefault(_qid);

var _data = require('data.maybe');

var _constants = require('../constants');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class File {
  static of(data) {
    return new File(data);
  }

  /**
   * @param {Dirent + Impl} data
   * where Impl is:
   {
    parent: 'File',
    children: {'': 'File'},
    nchildren: ['File']
   }
   */
  constructor(data) {
    (0, _assert2.default)(data.name, 'name must be defined');
    // assert(data.uid, 'uid must be defined')
    // assert(data.gid, 'gid must be defined')
    (0, _assert2.default)(!(0, _util.isNil)(data.mode), 'mode must be defined');
    (0, _assert2.default)(data.qid instanceof _qid2.default, 'qid must be defined');

    const now = new Date().valueOf();

    const uid = data.uid || _user.USER_DEFAULT.uid;
    const gid = data.gid || _user.USER_DEFAULT.groups[0].gid;

    Object.assign(this, data);
    Object.assign(this, {
      type: 0,
      dev: 0,
      atime: now,
      mtime: now,
      length: 0,
      uid: uid,
      gid: gid,
      muid: uid
    });

    if (this.isFile()) {
      // allocate an inital buffer
      this.data = Buffer.alloc(0xff);
    }
  }

  isDir() {
    // return this.qid.type === QTDIR
    return !!(this.mode & _constants.DMDIR);
  }

  isFile() {
    // return this.qid.type === QTFILE
    return !this.isDir();
  }

  isReadable() {
    return !!(this.mode & (0, _util.octal)('0444'));
  }

  isReadableByGroup(group) {
    return this.gid === group.gid && !!(this.mode & (0, _util.octal)('0040'));
  }

  isReadableByOthers() {
    return !!(this.mode & (0, _util.octal)('0004'));
  }

  isReadableByUser(user) {
    let result = false;
    if (this.uid === user.uid) {
      result = result || !!(this.mode & (0, _util.octal)('0400'));
    }
    for (let i = 0; i < user.groups.length; ++i) {
      result = result || this.isReadableByGroup(user.groups[i]);
    }
    return result || this.isReadableByOthers();
  }

  isWritable() {
    return !!(this.mode & (0, _util.octal)('0222'));
  }

  isExecable() {
    return !!(this.mode & (0, _util.octal)('0111'));
  }

  isExclusive() {
    return !!(this.mode & _constants.DMEXCL);
  }

  mkfile(path, mode, extra = {}) {
    return this.lookup(path, true).map(parent => {
      (0, _assert2.default)(parent instanceof File, 'parent must be a file');
      path = path.split('/');
      const name = path[path.length - 1];

      if (parent.children[name]) {
        throw new Error(`Cannot create [${path}]. File exists`);
      }

      const file = new File({
        name: name,
        qid: new _qid2.default(_constants.QTFILE, 0, nextQidPath()),
        mode: mode & (~(0, _util.octal)('0666') | parent.mode & (0, _util.octal)('0666')),
        uid: extra.uid,
        gid: extra.gid,
        parent: parent
      });
      parent.children[name] = file;
      parent.nchildren.push(file);
      return file;
    });
  }

  mkauthfile(path) {
    return this.mkfile(path).map(file => {
      file.qid = new _qid2.default(file.qid.type | _constants.QTAUTH, file.qid.version, file.qid.path);
      file.mode = (0, _util.octal)('0600');
      return file;
    });
  }

  mkdir(path, mode, extra = {}) {
    return this.lookup(path, true).map(parent => {
      (0, _assert2.default)(parent instanceof File, 'parent must be a file');
      const pathParts = path.split('/');
      const name = pathParts[pathParts.length - 1];

      if (parent.children[name]) {
        throw new Error(`Cannot create [${path}]. File exists`);
      }

      const file = new File({
        name: name,
        qid: new _qid2.default(_constants.QTDIR, 0, nextQidPath()),
        mode: _constants.DMDIR + (mode & (~(0, _util.octal)('0777') | parent.mode & (0, _util.octal)('0777'))),
        uid: extra.uid,
        gid: extra.gid,

        parent: parent,
        children: {},
        nchildren: []
      });
      parent.children[name] = file;
      parent.nchildren.push(file);

      return file;
    });
  }

  getRoot() {
    let file = this;
    while (!file.isRoot()) {
      file = file.parent;
    }
    return file;
  }

  getFullPath() {
    const path = [];
    let file = this;
    while (!file.isRoot()) {
      path.unshift(file.name);
      file = file.parent;
    }
    return `/${path.join('/')}`;
  }

  isRoot() {
    return this.parent === null;
  }

  lookup(pathString, getParent) {
    (0, _assert2.default)(pathString != null, 'pathString must be defined');

    if (pathString === '/') {
      return (0, _data.Just)(this.getRoot());
    }

    let path = pathString.split('/');
    let file = this;
    for (let i = 0; i < path.length; ++i) {
      if (getParent && i === path.length - 1) {
        return (0, _data.Just)(file);
      }

      const next = path[i];
      if (next === '' || next === '.') {
        continue;
      } else if (next === '..') {
        file = file.parent || file;
      } else {
        file = file.children[next];
      }

      if (!file) {
        return (0, _data.Nothing)();
      }
    }

    return (0, _data.Just)(file);
  }

  read(offset, count) {
    if (this.isDir()) {
      throw new Error('Unsupported operation');
    }
    return this.data.slice(offset, offset + count);
  }

  readToEnd() {
    if (this.isDir()) {
      throw new Error('Unsupported operation');
    }
    return this.data.slice(0, this.sizeOfData());
  }

  sizeOfData() {
    const bufLen = this.data.length;
    if (this.data[bufLen - 1] !== 0) {
      return bufLen;
    }

    for (let i = 0; i < this.data.length; ++i) {
      if (this.data[i] === 0) {
        return i;
      }
    }
    return bufLen;
  }

  write(offset, count, data) {
    if (this.isDir()) {
      throw new Error('Unsupported operation');
    }
    if (offset + count > this.data.length) {
      this.data = Buffer.concat([this.data, Buffer.alloc(offset + count - this.data.length)]);
    }

    const buf = this.data;
    for (let i = 0; i < count; ++i) {
      buf[offset + i] = data[i];
    }
  }

  toJSON() {
    return {
      name: this.name,
      uid: this.uid,
      gid: this.gid,
      muid: this.muid,
      qid: this.qid,
      mode: this.mode,
      data: this.data,
      atime: this.atime,
      mtime: this.mtime
    };
  }

  static mkroot() {
    return new File({
      name: '/',
      uid: _user.ROOT_USER.uid,
      gid: _user.ROOT_USER.uid,
      qid: new _qid2.default(_constants.QTDIR, 0, nextQidPath()),
      // initally allow all access to root (no ~)
      mode: _constants.DMDIR + (0, _util.octal)('0755'),
      children: {},
      nchildren: [],
      parent: null
    });
  }
}

exports.default = File;
let lastQidPath = -1;

function nextQidPath() {
  return ++lastQidPath;
}

class Dirent {
  /**
   cf. https://swtch.com/plan9port/man/man9/read.html
   cf. https://swtch.com/plan9port/man/man9/stat.html
   TODO merge with class File
   The stat transaction inquires about the file identified by fid.
   The reply will contain a machine-independent directory entry,
   stat, laid out as follows:
    size[2]
   - total byte count of the following data
   type[2]
   - for kernel use
   dev[4]
   - for kernel use
    qid.type[1]
   - the type of the file (directory, etc.), represented as
     a bit vector corresponding to the high 8 bits of the
     file’s mode word.
   qid.vers[4]
   - version number for given path
   qid.path[8]
   - the file server’s unique identification for the file
    mode[4]
   - permissions and flags
    atime[4]
   - last access time
   mtime[4]
   - last modification time
    length[8]
   - length of file in bytes
    name[s]
   - file name; must be / if the file is the root directory of
     the server
    uid[s]
   - owner name
   gid[s]
   - group name
   muid[s]
   - name of the user who last modified the file
   */
}
exports.Dirent = Dirent;