class NetworkException extends Error {
    /**
     * Exception raised when the network fails.
     * @param {string} message - The error message.
     * @param {number} [status] - The optional status code.
     */
    constructor(message, status = null) {
        super(message);
        this.name = 'NetworkException';
        this.status = status;
    }
}

module.exports = NetworkException;