class AuthenticationException extends Error {
    /**
     * Exception raised when the authentication fails.
     * @param {string} message - The error message.
     * @param {number} [status] - The optional status code.
     */
    constructor(message, status = null) {
        super(message);
        this.name = 'AuthenticationException';
        this.status = status;
    }
}

module.exports = AuthenticationException;