// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPancakeRouter {
    function swapExactBNBForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);
    
    function swapExactTokensForBNB(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function WETH() external pure returns (address);
}

contract SniperBot {
    address public owner;
    IPancakeRouter public router;
    
    event Sniped(address token, uint256 bnbIn, uint256 tokensOut);
    event Sold(address token, uint256 tokensIn, uint256 bnbOut);
    
    constructor(address _router) {
        owner = msg.sender;
        router = IPancakeRouter(_router);
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    receive() external payable {}
    
    function snipeWithTaxCheck(
        address token,
        uint256 amountOutMin,
        uint256 maxTaxPercent,
        uint256 deadline
    ) external payable onlyOwner {
        require(msg.value > 0, "No BNB sent");
        require(maxTaxPercent <= 100, "Invalid tax");
        
        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = token;
        
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        
        uint[] memory amounts = router.swapExactBNBForTokens{value: msg.value}(
            amountOutMin,
            path,
            address(this),
            deadline
        );
        
        uint256 balAfter = IERC20(token).balanceOf(address(this));
        uint256 received = balAfter - balBefore;
        uint256 expected = amounts[1];
        
        require(received > 0, "No tokens received");
        
        uint256 taxPercent = ((expected - received) * 100) / expected;
        require(taxPercent <= maxTaxPercent, "Tax too high");
        
        emit Sniped(token, msg.value, received);
    }
    
    function sellTokens(
        address token,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) external onlyOwner {
        IERC20(token).approve(address(router), amountIn);
        
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = router.WETH();
        
        uint[] memory amounts = router.swapExactTokensForBNB(
            amountIn,
            amountOutMin,
            path,
            address(this),
            deadline
        );
        
        emit Sold(token, amountIn, amounts[1]);
    }
    
    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No tokens");
        IERC20(token).transfer(owner, balance);
    }
    
    function emergencyWithdrawBNB() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
    
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}